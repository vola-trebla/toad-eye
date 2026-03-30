import { createHash } from "node:crypto";
import { trace, type Span, SpanStatusCode } from "@opentelemetry/api";
import type { LLMSpanAttributes, LLMProvider } from "../types/index.js";
import { GEN_AI_ATTRS, INSTRUMENTATION_NAME } from "../types/index.js";
import { recordThinkingRatio } from "./metrics.js";
import { getConfig } from "./tracer.js";
import { calculateCost } from "./pricing.js";
import {
  performBudgetPreCheck,
  recordSuccessMetrics,
  evaluateContextGuard,
  recordBudgetPostCheck,
  handleErrorMetrics,
} from "./lifecycle.js";

/** Input for traceLLMCall — what the user knows before calling the LLM */
export interface LLMCallInput {
  readonly provider: LLMProvider;
  readonly model: string;
  readonly prompt: string;
  readonly temperature?: number | undefined;
  /** OTel operation name for span naming. Default: "chat". */
  readonly operationName?: string | undefined;
  /** Per-request FinOps attributes (team, userId, feature, etc). Merged with global attributes. */
  readonly attributes?: Readonly<Record<string, string>> | undefined;
}

/** Output from the LLM call — what comes back */
export interface LLMCallOutput {
  readonly completion: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Cost in USD. If omitted, auto-calculated from model pricing table. */
  readonly cost?: number | undefined;
  /** Thinking/reasoning content from thinking models (o1, Claude extended thinking, Gemini). */
  readonly thinkingContent?: string | undefined;
  /** Thinking/reasoning tokens used (separate from outputTokens). */
  readonly thinkingTokens?: number | undefined;
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
    console.warn(
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

export function processContent(text: string): string | undefined {
  const config = getConfig();
  if (config?.recordContent === false) return undefined;

  // Content sampling — record only a fraction of calls
  if (config?.contentSamplingRate !== undefined) {
    if (Math.random() >= config.contentSamplingRate) return undefined;
  }

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
      try {
        const [result, count] = applyRedaction(processed, pattern);
        processed = result;
        totalRedacted += count;
      } catch {
        console.warn(
          `toad-eye: invalid redact pattern skipped: ${pattern.source}`,
        );
      }
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
    [GEN_AI_ATTRS.OPERATION]: input.operationName ?? "chat",
    ...(prompt !== undefined && { [GEN_AI_ATTRS.PROMPT]: prompt }),
    ...(sessionId !== undefined && { [GEN_AI_ATTRS.SESSION_ID]: sessionId }),
    ...attrs,
  });
}

function setSuccessAttributes(
  span: Span,
  input: LLMCallInput,
  output: LLMCallOutput,
  resolvedCost: number,
) {
  const completion = processContent(output.completion);
  span.setAttributes({
    ...(completion !== undefined && { [GEN_AI_ATTRS.COMPLETION]: completion }),
    [GEN_AI_ATTRS.RESPONSE_MODEL]: input.model,
    [GEN_AI_ATTRS.INPUT_TOKENS]: output.inputTokens,
    [GEN_AI_ATTRS.OUTPUT_TOKENS]: output.outputTokens,
    [GEN_AI_ATTRS.COST]: resolvedCost,
    [GEN_AI_ATTRS.STATUS]: "success",
    [GEN_AI_ATTRS.FINISH_REASONS]: ["stop"],
  });

  // Thinking model support (o1, Claude extended thinking, Gemini)
  if (output.thinkingTokens !== undefined && output.thinkingTokens > 0) {
    span.setAttribute("gen_ai.usage.reasoning_tokens", output.thinkingTokens);
    const ratio =
      output.thinkingTokens / (output.outputTokens + output.thinkingTokens);
    span.setAttribute("gen_ai.toad_eye.thinking.ratio", ratio);
    recordThinkingRatio(ratio, input.provider, input.model);
  }
  if (output.thinkingContent !== undefined) {
    const config = getConfig();
    const recordThinking = config?.recordContent !== false;
    if (recordThinking) {
      const processed = processContent(output.thinkingContent);
      if (processed !== undefined) {
        span.addEvent("gen_ai.thinking", {
          "gen_ai.toad_eye.thinking.content": processed,
        });
      }
    }
    span.setAttribute(
      "gen_ai.toad_eye.thinking.content_length",
      output.thinkingContent.length,
    );
  }

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
    console.warn(
      "toad-eye: traceLLMCall called before initObservability() — no telemetry will be recorded.",
    );
  }

  const userId = input.attributes?.[GEN_AI_ATTRS.USER_ID];
  const { effectiveProvider, effectiveModel, estimatedCost, budget } =
    performBudgetPreCheck(input.provider, input.model, userId);

  const effectiveInput =
    effectiveProvider !== input.provider || effectiveModel !== input.model
      ? {
          ...input,
          provider: effectiveProvider as LLMSpanAttributes["provider"],
          model: effectiveModel,
        }
      : input;

  const op = effectiveInput.operationName ?? "chat";

  return tracer.startActiveSpan(
    `${op} ${effectiveInput.model}`,
    async (span) => {
      const start = performance.now();
      setBaseAttributes(span, effectiveInput);

      try {
        const output = await fn();
        const duration = performance.now() - start;
        const attrs = resolveAttributes(effectiveInput);
        const resolvedCost =
          output.cost ??
          calculateCost(
            effectiveInput.model,
            output.inputTokens,
            output.outputTokens,
          );

        setSuccessAttributes(span, effectiveInput, output, resolvedCost);

        recordSuccessMetrics({
          duration,
          provider: effectiveInput.provider,
          model: effectiveInput.model,
          cost: resolvedCost,
          inputTokens: output.inputTokens,
          outputTokens: output.outputTokens,
          completion: output.completion,
          attrs,
        });

        evaluateContextGuard(
          span,
          effectiveInput.model,
          effectiveInput.provider,
          output.inputTokens,
        );

        recordBudgetPostCheck(
          budget,
          resolvedCost,
          effectiveInput.model,
          effectiveInput.attributes?.[GEN_AI_ATTRS.USER_ID],
          estimatedCost,
        );

        return output;
      } catch (error) {
        const duration = performance.now() - start;
        const message = error instanceof Error ? error.message : String(error);

        setErrorAttributes(span, message);
        handleErrorMetrics(
          error,
          duration,
          effectiveInput.provider,
          effectiveInput.model,
          budget,
          estimatedCost,
          resolveAttributes(effectiveInput),
        );

        throw error;
      } finally {
        span.end();
      }
    },
  );
}
