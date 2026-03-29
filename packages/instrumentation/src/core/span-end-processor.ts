/**
 * SpanProcessor that calls user's onSpanEnd callback with structured span data.
 *
 * Extracts LLM/MCP-relevant attributes from ReadableSpan into a clean
 * SpanEndData object — user never touches OTel SDK internals.
 */

import type {
  SpanProcessor,
  ReadableSpan,
} from "@opentelemetry/sdk-trace-base";
import { SpanKind, SpanStatusCode } from "@opentelemetry/api";

/** Structured span data passed to the onSpanEnd callback. */
export interface SpanEndData {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId: string | undefined;
  readonly name: string;
  readonly kind: "client" | "server" | "internal" | "producer" | "consumer";
  readonly status: "ok" | "error" | "unset";
  readonly durationMs: number;
  readonly startTime: Date;
  readonly endTime: Date;
  readonly attributes: Readonly<Record<string, string | number | boolean>>;
  readonly error: string | undefined;
}

const SPAN_KIND_MAP: Record<number, SpanEndData["kind"]> = {
  [SpanKind.CLIENT]: "client",
  [SpanKind.SERVER]: "server",
  [SpanKind.INTERNAL]: "internal",
  [SpanKind.PRODUCER]: "producer",
  [SpanKind.CONSUMER]: "consumer",
};

function hrtimeToDate(hrtime: [number, number]): Date {
  return new Date(hrtime[0] * 1000 + hrtime[1] / 1_000_000);
}

function hrtimeDurationMs(
  start: [number, number],
  end: [number, number],
): number {
  return (end[0] - start[0]) * 1000 + (end[1] - start[1]) / 1_000_000;
}

function flattenAttributes(
  attrs: Record<string, unknown>,
): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      result[key] = value;
    }
  }
  return result;
}

function toSpanEndData(span: ReadableSpan): SpanEndData {
  const ctx = span.spanContext();
  return {
    traceId: ctx.traceId,
    spanId: ctx.spanId,
    parentSpanId: span.parentSpanContext?.spanId,
    name: span.name,
    kind: SPAN_KIND_MAP[span.kind] ?? "internal",
    status:
      span.status.code === SpanStatusCode.ERROR
        ? "error"
        : span.status.code === SpanStatusCode.OK
          ? "ok"
          : "unset",
    durationMs: hrtimeDurationMs(span.startTime, span.endTime),
    startTime: hrtimeToDate(span.startTime),
    endTime: hrtimeToDate(span.endTime),
    attributes: flattenAttributes(span.attributes as Record<string, unknown>),
    error: span.status.message || undefined,
  };
}

export type OnSpanEndCallback = (data: SpanEndData) => void | Promise<void>;

export class ToadEyeSpanEndProcessor implements SpanProcessor {
  private readonly callback: OnSpanEndCallback;

  constructor(callback: OnSpanEndCallback) {
    this.callback = callback;
  }

  onStart() {}

  onEnd(span: ReadableSpan) {
    try {
      const result = this.callback(toSpanEndData(span));
      // If callback returns a promise, don't block — fire and forget
      if (result instanceof Promise) {
        result.catch((err) => {
          console.warn(
            `toad-eye: onSpanEnd callback failed: ${err instanceof Error ? err.message : err}`,
          );
        });
      }
    } catch (err) {
      console.warn(
        `toad-eye: onSpanEnd callback failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}
