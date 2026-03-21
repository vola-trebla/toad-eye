import { createHash } from "node:crypto";
import { trace, diag, type Span, SpanStatusCode } from "@opentelemetry/api";
import type { LLMSpanAttributes } from "../types/index.js";
import { GEN_AI_ATTRS, INSTRUMENTATION_NAME } from "../types/index.js";
import {
  recordRequestDuration,
  recordRequestCost,
  recordTokens,
  recordRequest,
  recordError,
  recordBudgetExceeded,
  recordBudgetBlocked,
  recordBudgetDowngraded,
  recordResponseEmpty,
  recordResponseLatencyPerToken,
} from "./metrics.js";
import { getConfig, getBudgetTracker } from "./tracer.js";
import { GEN_AI_ATTRS as ATTRS } from "../types/index.js";

/** Input for traceLLMCall — what the user knows before calling the LLM */
export interface LLMCallInput {
  readonly provider: LLMSpanAttributes["provider"];
  readonly model: string;
  readonly prompt: string;
  readonly temperature?: number | undefined;
  /** Per-request FinOps attributes (team, userId, feature, etc). Merged with global attributes. */
  readonly attributes?: Readonly<Record<string, string>> | undefined;
}

/** Output from the LLM call — what comes back */
export interface LLMCallOutput {
  readonly completion: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cost: number;
}

const tracer = trace.getTracer(INSTRUMENTATION_NAME);

let saltWarningEmitted = false;
// Track the last config ref so saltWarningEmitted resets across re-inits without circular imports
let lastConfigRef: object | null = null;

function sha256(text: string): string {
  const config = getConfig();
  const salt = config?.salt ?? "";

  // Auto-reset saltWarningEmitted when SDK is re-initialized (config ref changes)
  if (config !== lastConfigRef) {
    lastConfigRef = config;
    saltWarningEmitted = false;
  }

  if (config?.hashContent && !config.salt && !saltWarningEmitted) {
    diag.warn(
      "toad-eye: hashContent is enabled without salt — short strings may be reversible. Set salt in config for stronger privacy.",
    );
    saltWarningEmitted = true;
  }

  return createHash("sha256")
    .update(salt + text)
    .digest("hex");
}

// Built-in PII patterns — enabled via redactDefaults: true
// Note: no `g` flag here — a fresh RegExp is created per call to avoid lastIndex state issues
const DEFAULT_REDACT_PATTERNS: readonly RegExp[] = [
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/, // email
  /\b\d{3}-\d{2}-\d{4}\b/, // SSN (US)
  /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/, // credit card
  /\b\+?\d{1,3}[\s.-]?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}\b/, // phone
];

function applyRedaction(text: string, pattern: RegExp): [string, number] {
  let count = 0;
  const regex = new RegExp(pattern.source, "g");
  const result = text.replace(regex, () => {
    count++;
    return "[REDACTED]";
  });
  return [result, count];
}

function processContent(text: string): string | undefined {
  const config = getConfig();
  if (config?.recordContent === false) return undefined;

  let processed = text;
  let totalRedacted = 0;

  // Apply default PII patterns if enabled
  if (config?.redactDefaults) {
    for (const pattern of DEFAULT_REDACT_PATTERNS) {
      const [result, count] = applyRedaction(processed, pattern);
      processed = result;
      totalRedacted += count;
    }
  }

  // Apply custom patterns
  if (config?.redactPatterns?.length) {
    for (const pattern of config.redactPatterns) {
      const [result, count] = applyRedaction(processed, pattern);
      processed = result;
      totalRedacted += count;
    }
  }

  // Audit mode — log a summary only, never the original content (would re-expose PII)
  if (config?.auditMasking && totalRedacted > 0) {
    console.log(
      `[toad-eye audit] Content masked: ${totalRedacted} pattern(s) applied, ${text.length} chars → ${processed.length} chars`,
    );
  }

  if (config?.hashContent) {
    return `sha256:${sha256(processed)}`;
  }

  return processed;
}

function resolveSessionId(): string | undefined {
  const config = getConfig();
  return config?.sessionExtractor?.() ?? config?.sessionId;
}

/** Merge global config attributes with per-request attributes (per-request wins). */
function resolveAttributes(
  input: LLMCallInput,
): Record<string, string> | undefined {
  const global = getConfig()?.attributes;
  const local = input.attributes;
  if (!global && !local) return undefined;
  return { ...global, ...local };
}

function setBaseAttributes(span: Span, input: LLMCallInput) {
  const prompt = processContent(input.prompt);
  const sessionId = resolveSessionId();
  const attrs = resolveAttributes(input);
  span.setAttributes({
    [GEN_AI_ATTRS.PROVIDER]: input.provider,
    [GEN_AI_ATTRS.REQUEST_MODEL]: input.model,
    [GEN_AI_ATTRS.TEMPERATURE]: input.temperature ?? 1.0,
    [GEN_AI_ATTRS.OPERATION]: "chat",
    ...(prompt !== undefined && { [GEN_AI_ATTRS.PROMPT]: prompt }),
    ...(sessionId !== undefined && { [GEN_AI_ATTRS.SESSION_ID]: sessionId }),
    ...attrs,
  });
}

function recordBaseMetrics(
  duration: number,
  provider: string,
  model: string,
  attrs?: Record<string, string>,
) {
  recordRequest(provider, model, attrs);
  recordRequestDuration(duration, provider, model, attrs);
}

function setSuccessAttributes(
  span: Span,
  input: LLMCallInput,
  output: LLMCallOutput,
) {
  const completion = processContent(output.completion);
  span.setAttributes({
    ...(completion !== undefined && { [GEN_AI_ATTRS.COMPLETION]: completion }),
    [GEN_AI_ATTRS.RESPONSE_MODEL]: input.model,
    [GEN_AI_ATTRS.INPUT_TOKENS]: output.inputTokens,
    [GEN_AI_ATTRS.OUTPUT_TOKENS]: output.outputTokens,
    [GEN_AI_ATTRS.COST]: output.cost,
    [GEN_AI_ATTRS.STATUS]: "success",
    [GEN_AI_ATTRS.FINISH_REASONS]: ["stop"],
  });
  span.setStatus({ code: SpanStatusCode.OK });
}

function setErrorAttributes(span: Span, message: string) {
  const sanitized = processContent(message);
  span.setAttributes({
    [GEN_AI_ATTRS.INPUT_TOKENS]: 0,
    [GEN_AI_ATTRS.OUTPUT_TOKENS]: 0,
    [GEN_AI_ATTRS.COST]: 0,
    [GEN_AI_ATTRS.STATUS]: "error",
    ...(sanitized !== undefined && { [GEN_AI_ATTRS.ERROR]: sanitized }),
  });
  span.setStatus({
    code: SpanStatusCode.ERROR,
    ...(sanitized !== undefined && { message: sanitized }),
  });
}

export async function traceLLMCall(
  input: LLMCallInput,
  fn: () => Promise<LLMCallOutput>,
): Promise<LLMCallOutput> {
  if (!getConfig()) {
    diag.warn(
      "toad-eye: traceLLMCall called before initObservability() — no telemetry will be recorded.",
    );
  }

  const budget = getBudgetTracker();
  let effectiveInput = input;

  // Budget check BEFORE the LLM call
  if (budget) {
    const userId = input.attributes?.[ATTRS.USER_ID];
    const override = budget.checkBefore(input.provider, input.model, userId);
    if (override) {
      // Downgrade mode — use modified provider/model
      effectiveInput = {
        ...input,
        provider: override.provider as LLMSpanAttributes["provider"],
        model: override.model,
      };
      recordBudgetDowngraded("daily");
    }
  }

  return tracer.startActiveSpan(
    `gen_ai.${effectiveInput.provider}.${effectiveInput.model}`,
    async (span) => {
      const start = performance.now();
      setBaseAttributes(span, effectiveInput);

      try {
        const output = await fn();
        const duration = performance.now() - start;
        const attrs = resolveAttributes(effectiveInput);

        setSuccessAttributes(span, effectiveInput, output);
        recordBaseMetrics(
          duration,
          effectiveInput.provider,
          effectiveInput.model,
          attrs,
        );
        recordRequestCost(
          output.cost,
          effectiveInput.provider,
          effectiveInput.model,
          attrs,
        );
        recordTokens(
          output.inputTokens + output.outputTokens,
          effectiveInput.provider,
          effectiveInput.model,
          attrs,
        );

        // Proxy quality metrics — no extra dependencies, response text analysis only
        if (output.completion.trim() === "") {
          recordResponseEmpty(
            effectiveInput.provider,
            effectiveInput.model,
            attrs,
          );
        }
        if (output.outputTokens > 0) {
          recordResponseLatencyPerToken(
            duration / output.outputTokens,
            effectiveInput.provider,
            effectiveInput.model,
            attrs,
          );
        }

        // Budget recording AFTER the call
        if (budget) {
          const userId = effectiveInput.attributes?.[ATTRS.USER_ID];
          const exceeded = budget.recordCost(
            output.cost,
            effectiveInput.model,
            userId,
          );
          if (exceeded) {
            recordBudgetExceeded(exceeded.budget);
            console.warn(
              `toad-eye: ${exceeded.budget} budget exceeded — limit $${exceeded.limit}, current $${exceeded.current.toFixed(2)}`,
            );
          }
        }

        return output;
      } catch (error) {
        const duration = performance.now() - start;
        const message = error instanceof Error ? error.message : String(error);
        const attrs = resolveAttributes(effectiveInput);

        setErrorAttributes(span, message);
        recordBaseMetrics(
          duration,
          effectiveInput.provider,
          effectiveInput.model,
          attrs,
        );
        recordError(effectiveInput.provider, effectiveInput.model, attrs);

        // If this was a budget block, record the metric
        if (
          error instanceof Error &&
          error.name === "ToadBudgetExceededError"
        ) {
          recordBudgetBlocked("daily");
        }

        throw error;
      } finally {
        span.end();
      }
    },
  );
}
