// API key authentication middleware
// Validates Bearer token format: toad_xxxxx

import { bearerAuth } from "hono/bearer-auth";

import type { MiddlewareHandler } from "hono";

// Validates that the token has the toad_ prefix and matches the allowed list
export function createAuthMiddleware(
  apiKeys: readonly string[],
): MiddlewareHandler {
  const keySet = new Set(apiKeys);

  return bearerAuth({
    verifyToken: (token, _c) => {
      if (!token.toLowerCase().startsWith("toad_")) {
        return false;
      }
      return keySet.has(token);
    },
  });
}

// Extract API key from Authorization header (for use after auth middleware)
export function extractApiKey(authHeader: string | undefined): string {
  if (!authHeader?.startsWith("Bearer ")) return "unknown";
  return authHeader.slice(7);
}
