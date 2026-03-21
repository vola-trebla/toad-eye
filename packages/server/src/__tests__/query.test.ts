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
    provider?: string;
    model?: string;
    cost?: number;
    inputTokens?: number;
    outputTokens?: number;
    status?: string;
    error?: string;
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
                  key: "gen_ai.provider.name",
                  value: { stringValue: s.provider ?? "openai" },
                },
                {
                  key: "gen_ai.request.model",
                  value: { stringValue: s.model ?? "gpt-4o" },
                },
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
                ...(s.error
                  ? [{ key: "error.type", value: { stringValue: s.error } }]
                  : []),
              ],
            })),
          },
        ],
      },
    ],
  };
}

async function ingestSpans(
  app: ReturnType<typeof createApp>["app"],
  spans: Parameters<typeof makeTracePayload>[0],
) {
  await app.request("/v1/traces", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(makeTracePayload(spans)),
  });
}

const now = BigInt(Date.now()) * 1_000_000n;

describe("GET /api/errors", () => {
  let app: ReturnType<typeof createApp>["app"];

  beforeEach(() => {
    app = createApp(config).app;
  });

  it("returns empty list when no errors", async () => {
    const res = await app.request("/api/errors?period=1d", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(0);
    expect(body.errors).toEqual([]);
  });

  it("returns recent errors with context", async () => {
    await ingestSpans(app, [
      {
        name: "gen_ai.openai.gpt-4o",
        startNano: String(now),
        endNano: String(now + 100_000_000n),
        status: "success",
      },
      {
        name: "gen_ai.openai.gpt-4o",
        startNano: String(now),
        endNano: String(now + 200_000_000n),
        status: "error",
        error: "rate_limit_exceeded",
      },
    ]);

    const res = await app.request("/api/errors?period=1d", {
      headers: authHeaders(),
    });
    const body = await res.json();
    expect(body.count).toBe(1);
    expect(body.errors[0].error).toBe("rate_limit_exceeded");
    expect(body.errors[0].model).toBe("gpt-4o");
  });

  it("respects limit parameter", async () => {
    await ingestSpans(app, [
      {
        name: "s1",
        startNano: String(now),
        endNano: String(now + 100_000_000n),
        status: "error",
        error: "e1",
      },
      {
        name: "s2",
        startNano: String(now),
        endNano: String(now + 100_000_000n),
        status: "error",
        error: "e2",
      },
      {
        name: "s3",
        startNano: String(now),
        endNano: String(now + 100_000_000n),
        status: "error",
        error: "e3",
      },
    ]);

    const res = await app.request("/api/errors?period=1d&limit=2", {
      headers: authHeaders(),
    });
    const body = await res.json();
    expect(body.count).toBe(2);
  });
});

describe("GET /api/models/compare", () => {
  let app: ReturnType<typeof createApp>["app"];

  beforeEach(() => {
    app = createApp(config).app;
  });

  it("returns 400 without models param", async () => {
    const res = await app.request("/api/models/compare?period=7d", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(400);
  });

  it("compares models side by side", async () => {
    await ingestSpans(app, [
      {
        name: "llm",
        startNano: String(now),
        endNano: String(now + 100_000_000n),
        model: "gpt-4o",
        cost: 0.05,
      },
      {
        name: "llm",
        startNano: String(now),
        endNano: String(now + 50_000_000n),
        model: "gpt-4o-mini",
        cost: 0.005,
      },
    ]);

    const res = await app.request(
      "/api/models/compare?models=gpt-4o,gpt-4o-mini&period=7d",
      { headers: authHeaders() },
    );
    const body = await res.json();
    expect(body.models).toHaveLength(2);

    const gpt4o = body.models.find(
      (m: { model: string }) => m.model === "gpt-4o",
    );
    const mini = body.models.find(
      (m: { model: string }) => m.model === "gpt-4o-mini",
    );
    expect(gpt4o.spanCount).toBe(1);
    expect(mini.spanCount).toBe(1);
    expect(gpt4o.avgCost).toBeGreaterThan(mini.avgCost);
  });

  it("returns zero stats for unknown model", async () => {
    const res = await app.request(
      "/api/models/compare?models=nonexistent&period=7d",
      { headers: authHeaders() },
    );
    const body = await res.json();
    expect(body.models[0].spanCount).toBe(0);
  });
});

describe("GET /api/query", () => {
  let app: ReturnType<typeof createApp>["app"];

  beforeEach(() => {
    app = createApp(config).app;
  });

  it("returns summary of all telemetry", async () => {
    await ingestSpans(app, [
      {
        name: "llm",
        startNano: String(now),
        endNano: String(now + 100_000_000n),
        provider: "openai",
        model: "gpt-4o",
        cost: 0.05,
      },
      {
        name: "llm",
        startNano: String(now),
        endNano: String(now + 50_000_000n),
        provider: "anthropic",
        model: "claude-sonnet",
        cost: 0.01,
      },
    ]);

    const res = await app.request("/api/query?period=7d", {
      headers: authHeaders(),
    });
    const body = await res.json();
    expect(body.spanCount).toBe(2);
    expect(body.providers).toContain("openai");
    expect(body.providers).toContain("anthropic");
    expect(body.models).toContain("gpt-4o");
    expect(body.totalCost).toBeCloseTo(0.06, 2);
  });

  it("returns empty when no data", async () => {
    const res = await app.request("/api/query?period=7d", {
      headers: authHeaders(),
    });
    const body = await res.json();
    expect(body.spanCount).toBe(0);
  });
});

describe("auth required for /api/* routes", () => {
  let app: ReturnType<typeof createApp>["app"];

  beforeEach(() => {
    app = createApp(config).app;
  });

  it("rejects /api/errors without auth", async () => {
    const res = await app.request("/api/errors?period=1d");
    expect(res.status).toBe(401);
  });

  it("rejects /api/models/compare without auth", async () => {
    const res = await app.request("/api/models/compare?models=gpt-4o");
    expect(res.status).toBe(401);
  });

  it("rejects /api/query without auth", async () => {
    const res = await app.request("/api/query");
    expect(res.status).toBe(401);
  });
});

describe("edge cases", () => {
  let app: ReturnType<typeof createApp>["app"];

  beforeEach(() => {
    app = createApp(config).app;
  });

  it("handles empty models parameter gracefully", async () => {
    const res = await app.request("/api/models/compare?models=&period=7d", {
      headers: authHeaders(),
    });
    // Empty models param treated as missing — returns 400
    expect(res.status).toBe(400);
  });
});
