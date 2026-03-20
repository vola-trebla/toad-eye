// Hono app — assembles routes, middleware, and storage into a single application

import { Hono } from "hono";
import { logger } from "hono/logger";

import type { ServerConfig } from "./types.js";
import { MemoryStore } from "./storage/memory.js";
import { createAuthMiddleware } from "./middleware/auth.js";
import { createRateLimitMiddleware } from "./middleware/rate-limit.js";
import { createIngestRoutes } from "./routes/ingest.js";
import { createHealthRoutes } from "./routes/health.js";
import { createBaselineRoutes } from "./routes/baselines.js";
import { createQueryRoutes } from "./routes/query.js";

export function createApp(config: ServerConfig) {
  const app = new Hono();
  const store = new MemoryStore();

  // Global middleware
  app.use("*", logger());

  // Health check — no auth required
  app.route("/", createHealthRoutes(store));

  // Query APIs — auth required
  app.use("/api/*", createAuthMiddleware(config.apiKeys));
  app.route("/", createBaselineRoutes(store));
  app.route("/", createQueryRoutes(store));

  // Ingestion routes — auth + rate limiting
  app.use(
    "/v1/*",
    createRateLimitMiddleware({
      windowMs: config.rateLimit.windowMs,
      maxRequests: config.rateLimit.maxRequests,
    }),
  );
  app.use("/v1/*", createAuthMiddleware(config.apiKeys));
  app.route("/", createIngestRoutes(store));

  return { app, store };
}
