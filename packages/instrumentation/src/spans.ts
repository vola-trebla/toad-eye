import { createHash } from "node:crypto";
import { trace, type Span, SpanStatusCode } from "@opentelemetry/api";
import type { LLMSpanAttributes } from "./types/index.js";
import { GEN_AI_ATTRS, INSTRUMENTATION_NAME } from "./types/index.js";
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

function setBaseAttributes(span: Span, input: LLMCallInput) {
  const prompt = processContent(input.prompt);
  const sessionId = resolveSessionId();
  span.setAttributes({
    [GEN_AI_ATTRS.PROVIDER]: input.provider,
    [GEN_AI_ATTRS.REQUEST_MODEL]: input.model,
    [GEN_AI_ATTRS.TEMPERATURE]: input.temperature ?? 1.0,
    [GEN_AI_ATTRS.OPERATION]: "chat",
    ...(prompt !== undefined && { [GEN_AI_ATTRS.PROMPT]: prompt }),
    ...(sessionId !== undefined && { [GEN_AI_ATTRS.SESSION_ID]: sessionId }),
  });
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
        const completion = processContent(output.completion);

        span.setAttributes({
          ...(completion !== undefined && {
            [GEN_AI_ATTRS.COMPLETION]: completion,
          }),
          [GEN_AI_ATTRS.RESPONSE_MODEL]: input.model,
          [GEN_AI_ATTRS.INPUT_TOKENS]: output.inputTokens,
          [GEN_AI_ATTRS.OUTPUT_TOKENS]: output.outputTokens,
          [GEN_AI_ATTRS.COST]: output.cost,
          [GEN_AI_ATTRS.STATUS]: "success",
          [GEN_AI_ATTRS.FINISH_REASONS]: ["stop"],
        });
        span.setStatus({ code: SpanStatusCode.OK });

        recordRequest(input.provider, input.model);
        recordRequestDuration(duration, input.provider, input.model);
        recordRequestCost(output.cost, input.provider, input.model);
        recordTokens(
          output.inputTokens + output.outputTokens,
          input.provider,
          input.model,
        );

        return output;
      } catch (error) {
        const duration = performance.now() - start;
        const message = error instanceof Error ? error.message : String(error);

        span.setAttributes({
          [GEN_AI_ATTRS.INPUT_TOKENS]: 0,
          [GEN_AI_ATTRS.OUTPUT_TOKENS]: 0,
          [GEN_AI_ATTRS.COST]: 0,
          [GEN_AI_ATTRS.STATUS]: "error",
          [GEN_AI_ATTRS.ERROR]: message,
        });
        span.setStatus({ code: SpanStatusCode.ERROR, message });

        recordRequest(input.provider, input.model);
        recordRequestDuration(duration, input.provider, input.model);
        recordError(input.provider, input.model);

        throw error;
      } finally {
        span.end();
      }
    },
  );
}
