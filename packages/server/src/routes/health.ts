// Health check route — for deployment probes and status monitoring

import { Hono } from "hono";

import type { MemoryStore } from "../storage/memory.js";

export function createHealthRoutes(store: MemoryStore) {
  const app = new Hono();

  // GET /health — liveness + basic stats (no auth required)
  app.get("/health", (c) => {
    return c.json({
      status: "ok",
      version: "0.1.0",
      uptime: Math.floor(process.uptime()),
      stats: {
        traces: store.getTraceCount(),
        metrics: store.getMetricsCount(),
        spans: store.getSpanCount(),
      },
    });
  });

  return app;
}
