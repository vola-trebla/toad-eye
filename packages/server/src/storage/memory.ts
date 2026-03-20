// In-memory telemetry storage — MVP backing store
// Stores ingested traces and metrics with a size cap to prevent OOM

import type {
  OtlpTracePayload,
  OtlpMetricsPayload,
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

  addTrace(apiKey: string, payload: OtlpTracePayload) {
    if (this.traces.length >= this.maxItems) {
      // Drop oldest 10% when full
      const dropCount = Math.ceil(this.maxItems * 0.1);
      this.traces.splice(0, dropCount);
    }

    this.traces.push({
      receivedAt: new Date().toISOString(),
      apiKey,
      payload,
    });
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

  clear() {
    this.traces.length = 0;
    this.metrics.length = 0;
  }
}
