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

const validTracePayload = {
  resourceSpans: [
    {
      resource: {
        attributes: [
          { key: "service.name", value: { stringValue: "test-svc" } },
        ],
      },
      scopeSpans: [
        {
          spans: [
            {
              traceId: "abcdef1234567890abcdef1234567890",
              spanId: "1234567890abcdef",
              name: "llm.chat",
              startTimeUnixNano: "1000000000",
              endTimeUnixNano: "2000000000",
            },
          ],
        },
      ],
    },
  ],
};

const validMetricsPayload = {
  resourceMetrics: [
    {
      scopeMetrics: [
        {
          metrics: [
            {
              name: "gen_ai.client.requests",
              sum: { dataPoints: [{ timeUnixNano: "1000000000", asInt: "5" }] },
            },
          ],
        },
      ],
    },
  ],
};

describe("ingestion server", () => {
  let app: ReturnType<typeof createApp>["app"];
  let store: ReturnType<typeof createApp>["store"];

  beforeEach(() => {
    const result = createApp(config);
    app = result.app;
    store = result.store;
  });

  describe("GET /health", () => {
    it("returns status ok without auth", async () => {
      const res = await app.request("/health");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("ok");
      expect(body.stats).toEqual({ traces: 0, metrics: 0, spans: 0 });
    });
  });

  describe("POST /v1/traces", () => {
    it("accepts valid OTLP trace payload", async () => {
      const res = await app.request("/v1/traces", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(validTracePayload),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("ok");
      expect(store.getTraceCount()).toBe(1);
      expect(store.getSpanCount()).toBe(1);
    });

    it("rejects request without auth", async () => {
      const res = await app.request("/v1/traces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validTracePayload),
      });

      expect(res.status).toBe(401);
    });

    it("rejects request with invalid API key", async () => {
      const res = await app.request("/v1/traces", {
        method: "POST",
        headers: {
          Authorization: "Bearer wrong_key",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(validTracePayload),
      });

      expect(res.status).toBe(401);
    });

    it("rejects request with non-toad_ prefix key", async () => {
      const res = await app.request("/v1/traces", {
        method: "POST",
        headers: {
          Authorization: "Bearer sk_not_a_toad_key",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(validTracePayload),
      });

      expect(res.status).toBe(401);
    });

    it("rejects invalid trace payload", async () => {
      const res = await app.request("/v1/traces", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ bad: "data" }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("Invalid trace payload");
    });
  });

  describe("POST /v1/metrics", () => {
    it("accepts valid OTLP metrics payload", async () => {
      const res = await app.request("/v1/metrics", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(validMetricsPayload),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("ok");
      expect(store.getMetricsCount()).toBe(1);
    });

    it("rejects invalid metrics payload", async () => {
      const res = await app.request("/v1/metrics", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ wrong: "format" }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("Invalid metrics payload");
    });
  });

  describe("health reflects ingested data", () => {
    it("shows updated counts after ingestion", async () => {
      // Ingest some data
      await app.request("/v1/traces", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(validTracePayload),
      });

      await app.request("/v1/metrics", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(validMetricsPayload),
      });

      const res = await app.request("/health");
      const body = await res.json();
      expect(body.stats.traces).toBe(1);
      expect(body.stats.metrics).toBe(1);
      expect(body.stats.spans).toBe(1);
    });
  });
});
