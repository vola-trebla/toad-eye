/**
 * Vercel AI SDK integration — enriches AI SDK OTel spans with toad-eye
 * cost tracking and metrics. No monkey-patching needed.
 *
 * The Vercel AI SDK already emits OTel spans when `experimental_telemetry`
 * is enabled. This module adds a SpanProcessor that intercepts those spans
 * and calculates cost from token usage.
 *
 * Usage:
 * ```ts
 * import { initObservability } from 'toad-eye';
 * import { withToadEye } from 'toad-eye/vercel';
 *
 * initObservability({ serviceName: 'my-app' });
 *
 * const result = await generateText({
 *   model: openai('gpt-4o'),
 *   prompt: 'Hello',
 *   experimental_telemetry: withToadEye(),
 * });
 * ```
 */

import type {
  SpanProcessor,
  ReadableSpan,
} from "@opentelemetry/sdk-trace-base";
import { calculateCost } from "./core/pricing.js";
import {
  recordRequestCost,
  recordTokens,
  recordRequest,
  recordRequestDuration,
} from "./core/metrics.js";

// Vercel AI SDK span operation names
const AI_SDK_OPERATIONS = new Set([
  "ai.generateText",
  "ai.streamText",
  "ai.generateObject",
  "ai.streamObject",
]);

function isAiSdkSpan(span: ReadableSpan): boolean {
  const opId = span.attributes["ai.operationId"];
  if (typeof opId === "string") return AI_SDK_OPERATIONS.has(opId);
  return AI_SDK_OPERATIONS.has(span.name);
}

function getStringAttr(span: ReadableSpan, key: string): string | undefined {
  const val = span.attributes[key];
  return typeof val === "string" ? val : undefined;
}

function getNumberAttr(span: ReadableSpan, key: string): number {
  const val = span.attributes[key];
  return typeof val === "number" ? val : 0;
}

/**
 * OTel SpanProcessor that enriches Vercel AI SDK spans with toad-eye
 * cost attributes and records metrics.
 */
export class ToadEyeAISpanProcessor implements SpanProcessor {
  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }

  onStart(): void {
    // no-op — we process on end
  }

  onEnd(span: ReadableSpan): void {
    if (!isAiSdkSpan(span)) return;

    const model =
      getStringAttr(span, "gen_ai.request.model") ??
      getStringAttr(span, "ai.model.id") ??
      "unknown";

    const provider =
      getStringAttr(span, "gen_ai.system") ??
      getStringAttr(span, "ai.model.provider")?.split(".")[0] ??
      "unknown";

    const inputTokens =
      getNumberAttr(span, "gen_ai.usage.input_tokens") ||
      getNumberAttr(span, "ai.usage.promptTokens");

    const outputTokens =
      getNumberAttr(span, "gen_ai.usage.output_tokens") ||
      getNumberAttr(span, "ai.usage.completionTokens");

    // Calculate cost from token usage
    const cost = calculateCost(model, inputTokens, outputTokens);

    // We can't modify a ReadableSpan's attributes directly, but we can
    // record metrics which is the primary value-add
    const durationMs =
      (span.endTime[0] - span.startTime[0]) * 1000 +
      (span.endTime[1] - span.startTime[1]) / 1_000_000;

    recordRequest(provider, model);
    recordRequestDuration(durationMs, provider, model);
    if (cost > 0) {
      recordRequestCost(cost, provider, model);
    }
    if (inputTokens + outputTokens > 0) {
      recordTokens(inputTokens + outputTokens, provider, model);
    }
  }
}

/**
 * Helper for `experimental_telemetry` option — enables telemetry with
 * optional toad-eye metadata.
 *
 * ```ts
 * const result = await generateText({
 *   model: openai('gpt-4o'),
 *   prompt: 'Hello',
 *   experimental_telemetry: withToadEye({ functionId: 'my-feature' }),
 * });
 * ```
 */
export function withToadEye(options?: {
  functionId?: string;
  metadata?: Record<string, string>;
}) {
  return {
    isEnabled: true as const,
    ...options,
  };
}
