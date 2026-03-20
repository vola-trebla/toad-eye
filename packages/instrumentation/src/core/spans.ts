import { createHash } from "node:crypto";
import { trace, type Span, SpanStatusCode } from "@opentelemetry/api";
import type { LLMSpanAttributes } from "../types/index.js";
import { GEN_AI_ATTRS, INSTRUMENTATION_NAME } from "../types/index.js";
import {
  recordRequestDuration,
  recordRequestCost,
  recordTokens,
  recordRequest,
  recordError,
} from "./metrics.js";
import { getConfig } from "./tracer.js";

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

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function processContent(text: string): string | undefined {
  const config = getConfig();
  if (config?.recordContent === false) return undefined;

  let processed = text;

  if (config?.redactPatterns?.length) {
    for (const pattern of config.redactPatterns) {
      processed = processed.replace(pattern, "[REDACTED]");
    }
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
  span.setAttributes({
    [GEN_AI_ATTRS.INPUT_TOKENS]: 0,
    [GEN_AI_ATTRS.OUTPUT_TOKENS]: 0,
    [GEN_AI_ATTRS.COST]: 0,
    [GEN_AI_ATTRS.STATUS]: "error",
    [GEN_AI_ATTRS.ERROR]: message,
  });
  span.setStatus({ code: SpanStatusCode.ERROR, message });
}

export async function traceLLMCall(
  input: LLMCallInput,
  fn: () => Promise<LLMCallOutput>,
): Promise<LLMCallOutput> {
  return tracer.startActiveSpan(
    `gen_ai.${input.provider}.${input.model}`,
    async (span) => {
      const start = performance.now();
      setBaseAttributes(span, input);

      try {
        const output = await fn();
        const duration = performance.now() - start;
        const attrs = resolveAttributes(input);

        setSuccessAttributes(span, input, output);
        recordBaseMetrics(duration, input.provider, input.model, attrs);
        recordRequestCost(output.cost, input.provider, input.model, attrs);
        recordTokens(
          output.inputTokens + output.outputTokens,
          input.provider,
          input.model,
          attrs,
        );

        return output;
      } catch (error) {
        const duration = performance.now() - start;
        const message = error instanceof Error ? error.message : String(error);
        const attrs = resolveAttributes(input);

        setErrorAttributes(span, message);
        recordBaseMetrics(duration, input.provider, input.model, attrs);
        recordError(input.provider, input.model, attrs);

        throw error;
      } finally {
        span.end();
      }
    },
  );
}
