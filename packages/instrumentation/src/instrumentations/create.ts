import { createRequire } from "node:module";
import {
  trace,
  context,
  diag,
  SpanStatusCode,
  type Span,
} from "@opentelemetry/api";
import { traceLLMCall } from "../core/spans.js";
import type { LLMCallOutput } from "../core/spans.js";
import { calculateCost } from "../core/pricing.js";
import {
  recordRequestDuration,
  recordRequestCost,
  recordTokens,
  recordRequest,
  recordError,
  recordTimeToFirstToken,
} from "../core/metrics.js";
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
    inputTokens: 0,
    outputTokens: 0,
  };
  let firstChunk = true;
  try {
    for await (const chunk of stream) {
      if (firstChunk) {
        onFirstChunk();
        firstChunk = false;
      }
      accumulate(acc, chunk);
      yield chunk;
    }
    onComplete(acc);
  } catch (err) {
    onError(err);
    throw err;
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
    const req = patch.extractRequest(body);
    const start = performance.now();
    const response = await original.call(thisArg, body, ...rest);

    const span: Span = tracer.startSpan(`gen_ai.${providerName}.${req.model}`);
    const ctx = trace.setSpan(context.active(), span);

    span.setAttributes({
      [GEN_AI_ATTRS.PROVIDER]: providerName,
      [GEN_AI_ATTRS.REQUEST_MODEL]: req.model,
      [GEN_AI_ATTRS.TEMPERATURE]: req.temperature ?? 1.0,
      [GEN_AI_ATTRS.OPERATION]: "chat",
    });

    const wrapped = context.bind(
      ctx,
      wrapAsyncIterable(
        response as AsyncIterable<unknown>,
        (acc, chunk) => patch.accumulateChunk!(acc, chunk),
        () => {
          const ttft = performance.now() - start;
          recordTimeToFirstToken(ttft, providerName, req.model);
        },
        (acc) => {
          const duration = performance.now() - start;
          const cost = calculateCost(
            req.model,
            acc.inputTokens,
            acc.outputTokens,
          );

          span.setAttributes({
            [GEN_AI_ATTRS.RESPONSE_MODEL]: req.model,
            [GEN_AI_ATTRS.INPUT_TOKENS]: acc.inputTokens,
            [GEN_AI_ATTRS.OUTPUT_TOKENS]: acc.outputTokens,
            [GEN_AI_ATTRS.COST]: cost,
            [GEN_AI_ATTRS.STATUS]: "success",
          });
          span.setStatus({ code: SpanStatusCode.OK });
          span.end();

          recordRequest(providerName, req.model);
          recordRequestDuration(duration, providerName, req.model);
          recordRequestCost(cost, providerName, req.model);
          recordTokens(
            acc.inputTokens + acc.outputTokens,
            providerName,
            req.model,
          );
        },
        (err) => {
          const duration = performance.now() - start;
          const message = err instanceof Error ? err.message : String(err);
          span.setAttributes({
            [GEN_AI_ATTRS.STATUS]: "error",
            [GEN_AI_ATTRS.ERROR]: message,
          });
          span.setStatus({ code: SpanStatusCode.ERROR, message });
          span.end();

          recordRequest(providerName, req.model);
          recordRequestDuration(duration, providerName, req.model);
          recordError(providerName, req.model);
        },
      ),
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proxy = Object.create(response as any);
    proxy[Symbol.asyncIterator] = () => wrapped[Symbol.asyncIterator]();
    return proxy;
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

    const req = patch.extractRequest(body);

    return traceLLMCall(
      {
        provider: providerName,
        model: req.model,
        prompt: req.prompt,
        temperature: req.temperature,
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
