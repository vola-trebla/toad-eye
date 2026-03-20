// Rate limiting middleware — per API key throttling

import { rateLimiter } from "hono-rate-limiter";

import type { MiddlewareHandler } from "hono";

interface RateLimitConfig {
  readonly windowMs: number;
  readonly maxRequests: number;
}

export function createRateLimitMiddleware(
  config: RateLimitConfig,
): MiddlewareHandler {
  return rateLimiter({
    windowMs: config.windowMs,
    limit: config.maxRequests,
    // Rate limit per API key from Authorization header
    keyGenerator: (c) => {
      const auth = c.req.header("authorization") ?? "";
      return auth.startsWith("Bearer ") ? auth.slice(7) : "anonymous";
    },
    standardHeaders: "draft-7",
    message: {
      error: "Rate limit exceeded",
      message:
        "Too many requests. Please retry after the rate limit window resets.",
    },
  });
}
