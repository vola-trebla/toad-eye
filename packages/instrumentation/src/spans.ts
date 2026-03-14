import { trace, type Span, SpanStatusCode } from "@opentelemetry/api";
import type { LLMSpanAttributes } from "./types.js";
import { LLM_ATTRS, INSTRUMENTATION_NAME } from "./types.js";
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

function shouldRecordContent() {
  return getConfig()?.recordContent !== false;
}

function setBaseAttributes(span: Span, input: LLMCallInput) {
  span.setAttributes({
    [LLM_ATTRS.PROVIDER]: input.provider,
    [LLM_ATTRS.MODEL]: input.model,
    [LLM_ATTRS.TEMPERATURE]: input.temperature ?? 1.0,
    ...(shouldRecordContent() && { [LLM_ATTRS.PROMPT]: input.prompt }),
  });
}

export async function traceLLMCall(
  input: LLMCallInput,
  fn: () => Promise<LLMCallOutput>,
): Promise<LLMCallOutput> {
  return tracer.startActiveSpan(
    `llm.${input.provider}.${input.model}`,
    async (span) => {
      const start = performance.now();
      setBaseAttributes(span, input);

      try {
        const output = await fn();
        const duration = performance.now() - start;

        span.setAttributes({
          ...(shouldRecordContent() && {
            [LLM_ATTRS.COMPLETION]: output.completion,
          }),
          [LLM_ATTRS.INPUT_TOKENS]: output.inputTokens,
          [LLM_ATTRS.OUTPUT_TOKENS]: output.outputTokens,
          [LLM_ATTRS.COST]: output.cost,
          [LLM_ATTRS.STATUS]: "success",
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
          [LLM_ATTRS.COMPLETION]: "",
          [LLM_ATTRS.INPUT_TOKENS]: 0,
          [LLM_ATTRS.OUTPUT_TOKENS]: 0,
          [LLM_ATTRS.COST]: 0,
          [LLM_ATTRS.STATUS]: "error",
          [LLM_ATTRS.ERROR]: message,
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
