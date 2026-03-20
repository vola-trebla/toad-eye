import { describe, it, expect } from "vitest";

import {
  validateTracePayload,
  validateMetricsPayload,
} from "../validation/otlp.js";

describe("validateTracePayload", () => {
  it("accepts a valid OTLP trace payload", () => {
    const payload = {
      resourceSpans: [
        {
          resource: {
            attributes: [
              { key: "service.name", value: { stringValue: "test" } },
            ],
          },
          scopeSpans: [
            {
              spans: [
                {
                  traceId: "abc123",
                  spanId: "def456",
                  name: "llm.chat",
                  startTimeUnixNano: "1000000",
                  endTimeUnixNano: "2000000",
                },
              ],
            },
          ],
        },
      ],
    };

    expect(validateTracePayload(payload)).toEqual({ valid: true });
  });

  it("rejects null body", () => {
    const result = validateTracePayload(null);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("JSON object");
  });

  it("rejects missing resourceSpans", () => {
    const result = validateTracePayload({});
    expect(result.valid).toBe(false);
    expect(result.error).toContain("resourceSpans");
  });

  it("rejects missing scopeSpans", () => {
    const result = validateTracePayload({ resourceSpans: [{}] });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("scopeSpans");
  });

  it("rejects span without traceId", () => {
    const payload = {
      resourceSpans: [
        {
          scopeSpans: [{ spans: [{ spanId: "x", name: "y" }] }],
        },
      ],
    };
    const result = validateTracePayload(payload);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("traceId");
  });

  it("rejects span without name", () => {
    const payload = {
      resourceSpans: [
        {
          scopeSpans: [{ spans: [{ traceId: "x", spanId: "y" }] }],
        },
      ],
    };
    const result = validateTracePayload(payload);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("name");
  });
});

describe("validateMetricsPayload", () => {
  it("accepts a valid OTLP metrics payload", () => {
    const payload = {
      resourceMetrics: [
        {
          scopeMetrics: [
            {
              metrics: [
                {
                  name: "gen_ai.client.requests",
                  sum: {
                    dataPoints: [{ timeUnixNano: "1000000", asInt: "42" }],
                  },
                },
              ],
            },
          ],
        },
      ],
    };

    expect(validateMetricsPayload(payload)).toEqual({ valid: true });
  });

  it("rejects null body", () => {
    const result = validateMetricsPayload(null);
    expect(result.valid).toBe(false);
  });

  it("rejects missing resourceMetrics", () => {
    const result = validateMetricsPayload({});
    expect(result.valid).toBe(false);
    expect(result.error).toContain("resourceMetrics");
  });

  it("rejects metric without name", () => {
    const payload = {
      resourceMetrics: [
        {
          scopeMetrics: [
            {
              metrics: [{ sum: { dataPoints: [] } }],
            },
          ],
        },
      ],
    };
    const result = validateMetricsPayload(payload);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("name");
  });

  it("rejects metric without data type", () => {
    const payload = {
      resourceMetrics: [
        {
          scopeMetrics: [
            {
              metrics: [{ name: "some.metric" }],
            },
          ],
        },
      ],
    };
    const result = validateMetricsPayload(payload);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("sum, gauge, histogram");
  });
});
