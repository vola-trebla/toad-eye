import { describe, it, expect, beforeEach } from "vitest";

import { createApp } from "../app.js";

import type { ServerConfig } from "../types.js";

const TEST_KEY = "toad_test_key_123";

const config: ServerConfig = {
  port: 0,
  apiKeys: [TEST_KEY],
  rateLimit: { windowMs: 60_000, maxRequests: 100 },
};

function authHeaders() {
  return {
    Authorization: `Bearer ${TEST_KEY}`,
    "Content-Type": "application/json",
  };
}

function makeTracePayload(
  spans: Array<{
    name: string;
    startNano: string;
    endNano: string;
    cost?: number;
    inputTokens?: number;
    outputTokens?: number;
    status?: string;
  }>,
) {
  return {
    resourceSpans: [
      {
        scopeSpans: [
          {
            spans: spans.map((s, i) => ({
              traceId: `trace-${i}`,
              spanId: `span-${i}`,
              name: s.name,
              startTimeUnixNano: s.startNano,
              endTimeUnixNano: s.endNano,
              attributes: [
                {
                  key: "gen_ai.toad_eye.cost",
                  value: { doubleValue: s.cost ?? 0.01 },
                },
                {
                  key: "gen_ai.usage.input_tokens",
                  value: { intValue: String(s.inputTokens ?? 100) },
                },
                {
                  key: "gen_ai.usage.output_tokens",
                  value: { intValue: String(s.outputTokens ?? 50) },
                },
                {
                  key: "gen_ai.toad_eye.status",
                  value: { stringValue: s.status ?? "success" },
                },
              ],
            })),
          },
        ],
      },
    ],
  };
}

describe("GET /api/baselines", () => {
  let app: ReturnType<typeof createApp>["app"];

  beforeEach(() => {
    const result = createApp(config);
    app = result.app;
  });

  it("returns 400 when prompt is missing", async () => {
    const res = await app.request("/api/baselines", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("prompt");
  });

  it("returns 400 for invalid period", async () => {
    const res = await app.request("/api/baselines?prompt=test&period=99d", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Invalid period");
  });

  it("returns 401 without auth", async () => {
    const res = await app.request("/api/baselines?prompt=test");
    expect(res.status).toBe(401);
  });

  it("returns empty baseline when no matching spans", async () => {
    const res = await app.request(
      "/api/baselines?prompt=nonexistent&period=7d",
      {
        headers: authHeaders(),
      },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.spanCount).toBe(0);
    expect(body.avgLatencyMs).toBe(0);
    expect(body.prompt).toBe("nonexistent");
    expect(body.period).toBe("7d");
  });

  it("computes baselines from ingested spans", async () => {
    // Ingest some trace data
    // Spans: 100ms, 200ms, 500ms latency
    const now = BigInt(Date.now()) * 1_000_000n;
    const payload = makeTracePayload([
      {
        name: "gen_ai.openai.gpt-4o",
        startNano: String(now),
        endNano: String(now + 100_000_000n), // 100ms
        cost: 0.01,
        inputTokens: 100,
        outputTokens: 50,
      },
      {
        name: "gen_ai.openai.gpt-4o",
        startNano: String(now),
        endNano: String(now + 200_000_000n), // 200ms
        cost: 0.02,
        inputTokens: 200,
        outputTokens: 100,
      },
      {
        name: "gen_ai.openai.gpt-4o",
        startNano: String(now),
        endNano: String(now + 500_000_000n), // 500ms
        cost: 0.03,
        inputTokens: 300,
        outputTokens: 150,
        status: "error",
      },
    ]);

    await app.request("/v1/traces", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(payload),
    });

    // Query baselines
    const res = await app.request("/api/baselines?prompt=gpt-4o&period=7d", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.spanCount).toBe(3);
    expect(body.avgLatencyMs).toBe(267); // (100+200+500)/3 = 266.67 → 267
    expect(body.p95LatencyMs).toBe(500);
    expect(body.avgCost).toBeCloseTo(0.02, 4); // (0.01+0.02+0.03)/3
    expect(body.avgTokens).toBe(300); // (150+300+450)/3
    expect(body.errorRate).toBeCloseTo(0.3333, 3); // 1 error / 3 spans
  });

  it("defaults to 7d period when not specified", async () => {
    const res = await app.request("/api/baselines?prompt=test", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.period).toBe("7d");
  });
});
