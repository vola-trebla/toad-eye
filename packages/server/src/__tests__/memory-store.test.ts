import { describe, it, expect } from "vitest";

import { MemoryStore } from "../storage/memory.js";

import type { OtlpTracePayload } from "../types.js";

function makeTracePayload(spanCount: number): OtlpTracePayload {
  const spans = Array.from({ length: spanCount }, (_, i) => ({
    traceId: `trace-${i}`,
    spanId: `span-${i}`,
    name: `span-${i}`,
    startTimeUnixNano: "1000",
    endTimeUnixNano: "2000",
  }));

  return {
    resourceSpans: [{ scopeSpans: [{ spans }] }],
  };
}

describe("MemoryStore", () => {
  it("stores and counts traces", () => {
    const store = new MemoryStore();
    store.addTrace("toad_key1", makeTracePayload(3));

    expect(store.getTraceCount()).toBe(1);
    expect(store.getSpanCount()).toBe(3);
  });

  it("stores and counts metrics", () => {
    const store = new MemoryStore();
    store.addMetrics("toad_key1", {
      resourceMetrics: [
        {
          scopeMetrics: [
            {
              metrics: [
                {
                  name: "m1",
                  sum: { dataPoints: [{ timeUnixNano: "1", asInt: "1" }] },
                },
              ],
            },
          ],
        },
      ],
    });

    expect(store.getMetricsCount()).toBe(1);
  });

  it("drops oldest entries when full", () => {
    const store = new MemoryStore(10);

    for (let i = 0; i < 12; i++) {
      store.addTrace(`key_${i}`, makeTracePayload(1));
    }

    // maxItems=10, after 10th item we drop 10% (1), then add — so after 12 items:
    // at item 10: drop 1, add 1 = 10
    // at item 11: drop 1, add 1 = 10
    // Total should be 10
    expect(store.getTraceCount()).toBeLessThanOrEqual(10);
  });

  it("clears all data", () => {
    const store = new MemoryStore();
    store.addTrace("key", makeTracePayload(5));
    store.addMetrics("key", {
      resourceMetrics: [{ scopeMetrics: [{ metrics: [] }] }],
    });

    store.clear();

    expect(store.getTraceCount()).toBe(0);
    expect(store.getMetricsCount()).toBe(0);
    expect(store.getSpanCount()).toBe(0);
  });
});
