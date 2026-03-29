/**
 * Console span exporter — pretty-prints completed spans to stderr.
 *
 * Used in "light mode" (output: "console") — no Docker, no OTel Collector,
 * just immediate feedback in the terminal.
 *
 * Format:
 *   🐸 tools/call calculate  [42ms] ✅
 *   🐸 chat gpt-4o  [1.2s] $0.003 ✅
 *   🐸 tools/call broken  [12ms] ❌ TypeError
 */

import type { SpanExporter, ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { SpanStatusCode } from "@opentelemetry/api";
import { ExportResultCode, type ExportResult } from "@opentelemetry/core";

function formatDuration(ms: number): string {
  if (ms < 1) return "<1ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function getAttr(span: ReadableSpan, key: string): string | number | undefined {
  const val = span.attributes[key];
  if (typeof val === "string" || typeof val === "number") return val;
  return undefined;
}

function formatSpan(span: ReadableSpan): string {
  const durationMs =
    (span.endTime[0] - span.startTime[0]) * 1000 +
    (span.endTime[1] - span.startTime[1]) / 1_000_000;

  const isError = span.status.code === SpanStatusCode.ERROR;
  const icon = isError ? "❌" : "✅";

  const cost = getAttr(span, "gen_ai.toad_eye.cost");
  const costStr =
    typeof cost === "number" && cost > 0 ? ` $${cost.toFixed(4)}` : "";

  const errorType = isError ? getAttr(span, "error.type") : undefined;
  const errorStr = errorType ? ` ${errorType}` : "";

  return `  🐸 ${span.name}  [${formatDuration(durationMs)}]${costStr} ${icon}${errorStr}`;
}

// Filter out internal spans that add noise in console mode
const SKIP_PREFIXES = ["gen_ai.agent.step."];

function shouldShow(span: ReadableSpan): boolean {
  return !SKIP_PREFIXES.some((p) => span.name.startsWith(p));
}

export class ToadEyeConsoleExporter implements SpanExporter {
  export(
    spans: ReadableSpan[],
    resultCallback: (result: ExportResult) => void,
  ) {
    for (const span of spans) {
      if (shouldShow(span)) {
        process.stderr.write(formatSpan(span) + "\n");
      }
    }
    resultCallback({ code: ExportResultCode.SUCCESS });
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}
