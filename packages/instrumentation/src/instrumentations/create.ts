import { createRequire } from "node:module";
import {
  trace,
  context,
  diag,
  SpanStatusCode,
  type Span,
} from "@opentelemetry/api";
import { traceLLMCall, processContent } from "../core/spans.js";
import type { LLMCallOutput } from "../core/spans.js";
import { calculateCost, getModelPricing } from "../core/pricing.js";
import {
  recordRequestDuration,
  recordRequestCost,
  recordTokens,
  recordRequest,
  recordError,
  recordTimeToFirstToken,
  recordResponseEmpty,
  recordResponseLatencyPerToken,
  recordContextUtilization,
  recordContextBlocked,
  recordBudgetExceeded,
  recordBudgetDowngraded,
} from "../core/metrics.js";
import { getConfig, getBudgetTracker } from "../core/tracer.js";
import { ToadBudgetExceededError } from "../budget/index.js";
import { GEN_AI_ATTRS, INSTRUMENTATION_NAME } from "../types/index.js";
import type { LLMProvider } from "../types/index.js";
import type {
  Instrumentation,
  PatchTarget,
  StreamAccumulator,
} from "./types.js";

const require = createRequire(import.meta.url);

interface ActivePatch {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  proto: any;
  method: string;
  original: (...args: unknown[]) => unknown;
}

function isModuleInstalled(moduleName: string): boolean {
  try {
    require.resolve(moduleName);
    return true;
  } catch {
    return false;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function loadModule(moduleName: string): any {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sdk = require(moduleName);
  return sdk.default ?? sdk;
}

/**
 * Wrap an async iterable stream with an accumulator.
 * Yields every chunk transparently. Accumulates only extracted data (no raw chunks stored).
 * On stream end, calls onComplete with the accumulated result.
 * onFirstChunk is called once when the first chunk arrives (for TTFT tracking).
 */
async function* wrapAsyncIterable<T>(
  stream: AsyncIterable<T>,
  accumulate: (acc: StreamAccumulator, chunk: T) => void,
  onFirstChunk: () => void,
  onComplete: (acc: StreamAccumulator) => void,
  onError: (err: unknown) => void,
): AsyncGenerator<T> {
  const acc: StreamAccumulator = {
    completion: "",
    thinkingContent: "",
    inputTokens: 0,
    outputTokens: 0,
    toolCalls: [],
  };
  let firstChunk = true;
  let completed = false;
  let errored = false;
  try {
    for await (const chunk of stream) {
      if (firstChunk) {
        onFirstChunk();
        firstChunk = false;
      }
      accumulate(acc, chunk);
      yield chunk;
    }
    completed = true;
    onComplete(acc);
  } catch (err) {
    errored = true;
    onError(err);
    throw err;
  } finally {
    // If stream was abandoned (consumer broke out), still record what we have
    if (!completed && !errored) {
      onComplete(acc);
    }
  }
}

function createStreamingHandler(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  original: (...args: any[]) => unknown,
  patch: PatchTarget,
  providerName: LLMProvider,
) {
  const tracer = trace.getTracer(INSTRUMENTATION_NAME);

  return async function handleStreaming(
    thisArg: unknown,
    body: unknown,
    rest: unknown[],
  ) {
    // OpenAI does not send usage in streaming chunks by default.
    // Auto-inject stream_options to get token counts in the final chunk.
    if (providerName === "openai") {
      const b = body as Record<string, unknown>;
      if (!b["stream_options"]) {
        b["stream_options"] = { include_usage: true };
      }
    }

    // Pass thisArg so extractRequest can access instance properties (e.g., Gemini model name)
    const req = patch.extractRequest(body, thisArg);
    const start = performance.now();

    // Budget check BEFORE the LLM call — mirrors traceLLMCall behavior
    const budget = getBudgetTracker();
    const config = getConfig();
    const userId = config?.attributes?.[GEN_AI_ATTRS.USER_ID];
    const estimatedCost = budget ? calculateCost(req.model, 500, 200) : 0;

    let effectiveProvider: LLMProvider = providerName;
    let effectiveModel = req.model;

    if (budget) {
      const override = budget.checkBefore(
        providerName,
        req.model,
        userId,
        estimatedCost,
      );
      if (override) {
        effectiveProvider = override.provider as LLMProvider;
        effectiveModel = override.model;
        recordBudgetDowngraded(override.budget);
      }
    }

    const op = patch.operationName ?? "chat";
    const span: Span = tracer.startSpan(`${op} ${effectiveModel}`);
    const ctx = trace.setSpan(context.active(), span);
    const sessionId = config?.sessionExtractor?.() ?? config?.sessionId;
    let ttftMs = 0;

    span.setAttributes({
      [GEN_AI_ATTRS.PROVIDER]: effectiveProvider,
      [GEN_AI_ATTRS.REQUEST_MODEL]: effectiveModel,
      [GEN_AI_ATTRS.TEMPERATURE]: req.temperature ?? 1.0,
      [GEN_AI_ATTRS.OPERATION]: op,
      ...(sessionId !== undefined && { [GEN_AI_ATTRS.SESSION_ID]: sessionId }),
    });

    let response: unknown;
    try {
      response = await original.call(thisArg, body, ...rest);
    } catch (err) {
      const duration = performance.now() - start;
      const message = err instanceof Error ? err.message : String(err);

      // Release budget reservation — no cost was incurred
      if (budget) budget.releaseReservation(estimatedCost);

      span.setAttributes({
        [GEN_AI_ATTRS.STATUS]: "error",
        [GEN_AI_ATTRS.ERROR]: message,
      });
      span.setStatus({ code: SpanStatusCode.ERROR, message });
      span.end();

      recordRequest(effectiveProvider, effectiveModel);
      recordRequestDuration(duration, effectiveProvider, effectiveModel);
      recordError(effectiveProvider, effectiveModel);
      throw err;
    }

    // Some SDKs (Gemini) return { stream: AsyncIterable } instead of a direct AsyncIterable
    const resp = response as Record<string, unknown>;
    const hasStreamProp =
      resp != null &&
      typeof resp === "object" &&
      "stream" in resp &&
      resp["stream"] != null &&
      typeof resp["stream"] === "object" &&
      Symbol.asyncIterator in (resp["stream"] as object);
    const streamIterable = hasStreamProp
      ? (resp["stream"] as AsyncIterable<unknown>)
      : (response as AsyncIterable<unknown>);

    const wrapped = context.bind(
      ctx,
      wrapAsyncIterable(
        streamIterable,
        (acc, chunk) => patch.accumulateChunk!(acc, chunk),
        () => {
          const ttft = performance.now() - start;
          ttftMs = ttft;
          recordTimeToFirstToken(ttft, effectiveProvider, effectiveModel);

          // Span event for per-trace TTFT debugging in Jaeger
          span.addEvent("gen_ai.content.first_token", {
            "gen_ai.response.time_to_first_token_ms": ttft,
          });
          span.setAttribute("gen_ai.response.time_to_first_token_ms", ttft);
        },
        (acc) => {
          const duration = performance.now() - start;
          const cost = calculateCost(
            effectiveModel,
            acc.inputTokens,
            acc.outputTokens,
          );

          const processedCompletion = processContent(acc.completion);

          // Anthropic extended thinking — track separately from completion
          if (acc.thinkingContent.length > 0) {
            span.setAttribute(
              "gen_ai.toad_eye.thinking.content_length",
              acc.thinkingContent.length,
            );
          }

          // Record tool calls from streaming chunks
          if (acc.toolCalls.length > 0) {
            span.setAttribute(
              GEN_AI_ATTRS.TOOL_NAME,
              acc.toolCalls.map((t) => t.name).join(", "),
            );
            span.setAttribute("gen_ai.tool.call.count", acc.toolCalls.length);
          }

          span.setAttributes({
            ...(processedCompletion !== undefined && {
              [GEN_AI_ATTRS.COMPLETION]: processedCompletion,
            }),
            [GEN_AI_ATTRS.RESPONSE_MODEL]: effectiveModel,
            [GEN_AI_ATTRS.INPUT_TOKENS]: acc.inputTokens,
            [GEN_AI_ATTRS.OUTPUT_TOKENS]: acc.outputTokens,
            [GEN_AI_ATTRS.COST]: cost,
            [GEN_AI_ATTRS.STATUS]:
              acc.finishReason === "SAFETY" ? "error" : "success",
            [GEN_AI_ATTRS.FINISH_REASONS]: [acc.finishReason ?? "stop"],
          });
          if (acc.finishReason === "SAFETY") {
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: "Content blocked by safety filter",
            });
          } else {
            span.setStatus({ code: SpanStatusCode.OK });
          }
          span.end();

          recordRequest(effectiveProvider, effectiveModel);
          recordRequestDuration(duration, effectiveProvider, effectiveModel);
          recordRequestCost(cost, effectiveProvider, effectiveModel);
          recordTokens(
            acc.inputTokens + acc.outputTokens,
            effectiveProvider,
            effectiveModel,
          );

          // Quality metrics
          if (acc.completion.trim() === "") {
            recordResponseEmpty(effectiveProvider, effectiveModel);
          }
          if (acc.outputTokens > 0) {
            recordResponseLatencyPerToken(
              duration / acc.outputTokens,
              effectiveProvider,
              effectiveModel,
            );
          }

          // Context window utilization — ratio of input tokens to model's max context
          const pricing = getModelPricing(effectiveModel);
          if (pricing?.maxContextTokens && acc.inputTokens > 0) {
            const utilization = acc.inputTokens / pricing.maxContextTokens;
            span.setAttribute(GEN_AI_ATTRS.CONTEXT_UTILIZATION, utilization);
            recordContextUtilization(
              utilization,
              effectiveProvider,
              effectiveModel,
            );

            // Context guard — post-stream warning
            const guard = config?.contextGuard;
            if (guard) {
              if (guard.blockAt !== undefined && utilization >= guard.blockAt) {
                recordContextBlocked(effectiveModel);
                span.addEvent("gen_ai.context.limit_exceeded", {
                  "gen_ai.toad_eye.context_utilization": utilization,
                  "gen_ai.toad_eye.context.threshold": guard.blockAt,
                });
                console.warn(
                  `toad-eye: context window ${(utilization * 100).toFixed(0)}% full for ${effectiveModel} — exceeds blockAt threshold ${(guard.blockAt * 100).toFixed(0)}%. Compress context before next call.`,
                );
              } else if (
                guard.warnAt !== undefined &&
                utilization >= guard.warnAt
              ) {
                console.warn(
                  `toad-eye: context window ${(utilization * 100).toFixed(0)}% full for ${effectiveModel} (${acc.inputTokens}/${pricing.maxContextTokens} tokens)`,
                );
              }
            }
          }

          // Prefill/decode latency split — TTFT = prefill, rest = decode
          if (ttftMs > 0) {
            const decodeMs = duration - ttftMs;
            span.setAttribute("gen_ai.toad_eye.latency.decode_ms", decodeMs);
            if (acc.outputTokens > 0 && decodeMs > 0) {
              span.setAttribute(
                "gen_ai.toad_eye.throughput.tokens_per_second",
                acc.outputTokens / (decodeMs / 1000),
              );
            }
          }

          // Budget recording — releases the reservation made in checkBefore
          if (budget) {
            const exceeded = budget.recordCost(
              cost,
              effectiveModel,
              userId,
              estimatedCost,
            );
            if (exceeded) {
              recordBudgetExceeded(exceeded.budget);
              console.warn(
                `toad-eye: ${exceeded.budget} budget exceeded — limit $${exceeded.limit}, current $${exceeded.current.toFixed(2)}`,
              );
            }
          }
        },
        (err) => {
          const duration = performance.now() - start;
          const message = err instanceof Error ? err.message : String(err);

          // Release budget reservation on stream error
          if (budget) budget.releaseReservation(estimatedCost);

          span.setAttributes({
            [GEN_AI_ATTRS.STATUS]: "error",
            [GEN_AI_ATTRS.ERROR]: message,
          });
          span.setStatus({ code: SpanStatusCode.ERROR, message });
          span.end();

          recordRequest(effectiveProvider, effectiveModel);
          recordRequestDuration(duration, effectiveProvider, effectiveModel);
          recordError(effectiveProvider, effectiveModel);
        },
      ),
    );

    // Proxy preserves the original object shape (getters, private fields, methods)
    // while intercepting only the async iterator for instrumentation
    return new Proxy(response as object, {
      get(target, prop, receiver) {
        if (prop === Symbol.asyncIterator) {
          return () => wrapped[Symbol.asyncIterator]();
        }
        return Reflect.get(target, prop, receiver);
      },
    });
  };
}

function createPatchedMethod(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  original: (...args: any[]) => unknown,
  patch: PatchTarget,
  providerName: LLMProvider,
) {
  const streamHandler =
    patch.isStreaming && patch.accumulateChunk
      ? createStreamingHandler(original, patch, providerName)
      : null;

  return function patchedMethod(
    this: unknown,
    body: unknown,
    ...rest: unknown[]
  ) {
    if (patch.shouldSkip?.(body)) {
      return original.call(this, body, ...rest);
    }

    if (streamHandler && patch.isStreaming?.(body)) {
      return streamHandler(this, body, rest);
    }

    const req = patch.extractRequest(body, this);

    return traceLLMCall(
      {
        provider: providerName,
        model: req.model,
        prompt: req.prompt,
        temperature: req.temperature,
        operationName: patch.operationName,
      },
      async (): Promise<LLMCallOutput> => {
        const response = await original.call(this, body, ...rest);
        const res = patch.extractResponse(response, req.model);

        return {
          completion: res.completion,
          inputTokens: res.inputTokens,
          outputTokens: res.outputTokens,
          cost: calculateCost(req.model, res.inputTokens, res.outputTokens),
        };
      },
    );
  };
}

export function createInstrumentation(config: {
  name: LLMProvider;
  moduleName: string;
  patches: PatchTarget[];
}): Instrumentation {
  const activePatches: ActivePatch[] = [];

  return {
    name: config.name,

    enable() {
      if (!isModuleInstalled(config.moduleName)) return false;

      try {
        const mod = loadModule(config.moduleName);

        for (const patch of config.patches) {
          const proto = patch.getPrototype(mod);
          if (!proto?.[patch.method]) continue;

          const original = proto[patch.method] as (
            ...args: unknown[]
          ) => unknown;

          proto[patch.method] = createPatchedMethod(
            original,
            patch,
            config.name,
          );
          activePatches.push({ proto, method: patch.method, original });
        }

        return activePatches.length > 0;
      } catch (err) {
        // Clean up any patches applied before the failure
        for (const { proto, method, original } of activePatches) {
          proto[method] = original;
        }
        activePatches.length = 0;
        diag.warn(`toad-eye: failed to patch ${config.name}: ${err}`);
        return false;
      }
    },

    disable() {
      for (const { proto, method, original } of activePatches) {
        proto[method] = original;
      }
      activePatches.length = 0;
    },
  };
}
