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

const now = BigInt(Date.now()) * 1_000_000n;

function makeSpan(opts: { provider: string; status?: string; error?: string }) {
  return {
    traceId: `t-${Math.random()}`,
    spanId: `s-${Math.random()}`,
    name: "llm.call",
    startTimeUnixNano: String(now),
    endTimeUnixNano: String(now + 100_000_000n),
    attributes: [
      { key: "gen_ai.provider.name", value: { stringValue: opts.provider } },
      {
        key: "gen_ai.toad_eye.status",
        value: { stringValue: opts.status ?? "success" },
      },
      ...(opts.error
        ? [{ key: "error.type", value: { stringValue: opts.error } }]
        : []),
    ],
  };
}

async function ingestSpans(
  app: ReturnType<typeof createApp>["app"],
  spans: ReturnType<typeof makeSpan>[],
) {
  await app.request("/v1/traces", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      resourceSpans: [{ scopeSpans: [{ spans }] }],
    }),
  });
}

describe("GET /api/providers/health", () => {
  let app: ReturnType<typeof createApp>["app"];

  beforeEach(() => {
    app = createApp(config).app;
  });

  it("returns empty when no data", async () => {
    const res = await app.request("/api/providers/health?period=5m", {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.providers).toEqual([]);
  });

  it("shows healthy provider with no errors", async () => {
    await ingestSpans(app, [
      makeSpan({ provider: "openai" }),
      makeSpan({ provider: "openai" }),
      makeSpan({ provider: "openai" }),
    ]);

    const res = await app.request("/api/providers/health?period=5m", {
      headers: authHeaders(),
    });
    const body = await res.json();
    expect(body.providers).toHaveLength(1);
    expect(body.providers[0].provider).toBe("openai");
    expect(body.providers[0].status).toBe("healthy");
    expect(body.providers[0].errorRate).toBe(0);
  });

  it("detects degraded provider (> 10% errors)", async () => {
    // 8 success + 2 errors = 20% error rate → degraded
    const spans = [
      ...Array.from({ length: 8 }, () => makeSpan({ provider: "anthropic" })),
      makeSpan({
        provider: "anthropic",
        status: "error",
        error: "rate_limit_exceeded",
      }),
      makeSpan({
        provider: "anthropic",
        status: "error",
        error: "rate_limit_exceeded",
      }),
    ];
    await ingestSpans(app, spans);

    const res = await app.request("/api/providers/health?period=5m", {
      headers: authHeaders(),
    });
    const body = await res.json();
    expect(body.providers[0].status).toBe("degraded");
    expect(body.providers[0].rateLimitErrors).toBe(2);
  });

  it("detects down provider (> 50% errors)", async () => {
    // 2 success + 8 errors = 80% error rate → down
    const spans = [
      makeSpan({ provider: "gemini" }),
      makeSpan({ provider: "gemini" }),
      ...Array.from({ length: 8 }, () =>
        makeSpan({ provider: "gemini", status: "error", error: "timeout" }),
      ),
    ];
    await ingestSpans(app, spans);

    const res = await app.request("/api/providers/health?period=5m", {
      headers: authHeaders(),
    });
    const body = await res.json();
    expect(body.providers[0].status).toBe("down");
    expect(body.providers[0].timeoutErrors).toBe(8);
  });

  it("tracks multiple providers independently", async () => {
    await ingestSpans(app, [
      makeSpan({ provider: "openai" }),
      makeSpan({ provider: "openai" }),
      makeSpan({ provider: "anthropic", status: "error", error: "500" }),
      makeSpan({ provider: "anthropic", status: "error", error: "500" }),
    ]);

    const res = await app.request("/api/providers/health?period=5m", {
      headers: authHeaders(),
    });
    const body = await res.json();
    const openai = body.providers.find(
      (p: { provider: string }) => p.provider === "openai",
    );
    const anthropic = body.providers.find(
      (p: { provider: string }) => p.provider === "anthropic",
    );

    expect(openai.status).toBe("healthy");
    expect(anthropic.status).toBe("down"); // 100% errors
  });

  it("requires auth", async () => {
    const res = await app.request("/api/providers/health");
    expect(res.status).toBe(401);
  });
});
