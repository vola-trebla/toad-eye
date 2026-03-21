// In-memory telemetry storage — MVP backing store
// Stores ingested traces and metrics with a size cap to prevent OOM

import type {
  OtlpTracePayload,
  OtlpMetricsPayload,
  OtlpSpan,
  StoredTrace,
  StoredMetrics,
} from "../types.js";

const DEFAULT_MAX_ITEMS = 10_000;

export class MemoryStore {
  private readonly traces: StoredTrace[] = [];
  private readonly metrics: StoredMetrics[] = [];
  private readonly maxItems: number;

  constructor(maxItems = DEFAULT_MAX_ITEMS) {
    this.maxItems = maxItems;
  }

  addTrace(apiKey: string, payload: OtlpTracePayload): boolean {
    // Guard against oversized payloads
    let spanCount = 0;
    for (const rs of payload.resourceSpans) {
      for (const ss of rs.scopeSpans) {
        spanCount += ss.spans.length;
      }
    }
    if (spanCount > this.maxItems) return false;

    if (this.traces.length >= this.maxItems) {
      const dropCount = Math.ceil(this.maxItems * 0.1);
      this.traces.splice(0, dropCount);
    }

    this.traces.push({
      receivedAt: new Date().toISOString(),
      apiKey,
      payload,
    });
    return true;
  }

  addMetrics(apiKey: string, payload: OtlpMetricsPayload) {
    if (this.metrics.length >= this.maxItems) {
      const dropCount = Math.ceil(this.maxItems * 0.1);
      this.metrics.splice(0, dropCount);
    }

    this.metrics.push({
      receivedAt: new Date().toISOString(),
      apiKey,
      payload,
    });
  }

  getTraceCount(): number {
    return this.traces.length;
  }

  getMetricsCount(): number {
    return this.metrics.length;
  }

  getSpanCount(): number {
    let count = 0;
    for (const t of this.traces) {
      for (const rs of t.payload.resourceSpans) {
        for (const ss of rs.scopeSpans) {
          count += ss.spans.length;
        }
      }
    }
    return count;
  }

  /**
   * Query spans matching a name pattern within a time period.
   * Used by the baselines API to compute aggregated stats.
   */
  querySpans(namePattern: string, periodMs: number): readonly OtlpSpan[] {
    const cutoff = Date.now() - periodMs;
    const result: OtlpSpan[] = [];

    for (const t of this.traces) {
      const receivedAt = new Date(t.receivedAt).getTime();
      if (receivedAt < cutoff) continue;

      for (const rs of t.payload.resourceSpans) {
        for (const ss of rs.scopeSpans) {
          for (const span of ss.spans) {
            if (span.name.includes(namePattern)) {
              result.push(span);
            }
          }
        }
      }
    }

    return result;
  }

  clear() {
    this.traces.length = 0;
    this.metrics.length = 0;
  }
}
