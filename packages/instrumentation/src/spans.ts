import { trace, SpanStatusCode } from "@opentelemetry/api";
import type { LLMSpanAttributes } from "./types.js";
import {
  recordRequestDuration,
  recordRequestCost,
  recordTokens,
  recordRequest,
  recordError,
} from "./metrics.js";

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

const tracer = trace.getTracer("toad-eye");

export async function traceLLMCall(
  input: LLMCallInput,
  fn: () => Promise<LLMCallOutput>,
): Promise<LLMCallOutput> {
  return tracer.startActiveSpan(
    `llm.${input.provider}.${input.model}`,
    async (span) => {
      const start = performance.now();

      try {
        const output = await fn();
        const duration = performance.now() - start;

        span.setAttributes({
          "llm.provider": input.provider,
          "llm.model": input.model,
          "llm.prompt": input.prompt,
          "llm.completion": output.completion,
          "llm.input_tokens": output.inputTokens,
          "llm.output_tokens": output.outputTokens,
          "llm.cost": output.cost,
          "llm.temperature": input.temperature ?? 1.0,
          "llm.status": "success",
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
          "llm.provider": input.provider,
          "llm.model": input.model,
          "llm.prompt": input.prompt,
          "llm.completion": "",
          "llm.input_tokens": 0,
          "llm.output_tokens": 0,
          "llm.cost": 0,
          "llm.temperature": input.temperature ?? 1.0,
          "llm.status": "error",
          "llm.error": message,
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
