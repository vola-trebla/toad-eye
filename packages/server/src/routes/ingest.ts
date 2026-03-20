// Ingestion routes — accept OTLP traces and metrics via HTTP

import { Hono } from "hono";

import type { MemoryStore } from "../storage/memory.js";
import {
  validateTracePayload,
  validateMetricsPayload,
  asTracePayload,
  asMetricsPayload,
} from "../validation/otlp.js";
import { extractApiKey } from "../middleware/auth.js";

export function createIngestRoutes(store: MemoryStore) {
  const app = new Hono();

  // POST /v1/traces — accept OTLP trace data
  app.post("/v1/traces", async (c) => {
    const body = await c.req.json().catch(() => null);

    const result = validateTracePayload(body);
    if (!result.valid) {
      return c.json(
        { error: "Invalid trace payload", detail: result.error },
        400,
      );
    }

    const apiKey = extractApiKey(c.req.header("authorization"));
    store.addTrace(apiKey, asTracePayload(body));

    return c.json({ status: "ok" });
  });

  // POST /v1/metrics — accept OTLP metrics data
  app.post("/v1/metrics", async (c) => {
    const body = await c.req.json().catch(() => null);

    const result = validateMetricsPayload(body);
    if (!result.valid) {
      return c.json(
        { error: "Invalid metrics payload", detail: result.error },
        400,
      );
    }

    const apiKey = extractApiKey(c.req.header("authorization"));
    store.addMetrics(apiKey, asMetricsPayload(body));

    return c.json({ status: "ok" });
  });

  return app;
}
