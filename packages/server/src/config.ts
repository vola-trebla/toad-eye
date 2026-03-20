// Server configuration — reads from environment variables with sensible defaults

import type { ServerConfig } from "./types.js";

export function loadConfig(): ServerConfig {
  const apiKeysRaw = process.env["TOAD_API_KEYS"] ?? "";
  const apiKeys = apiKeysRaw
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0);

  if (apiKeys.length === 0) {
    // Generate a default key for development
    const devKey = "toad_dev_" + Math.random().toString(36).slice(2, 10);
    apiKeys.push(devKey);
    console.log(`No TOAD_API_KEYS set. Generated dev key: ${devKey}`);
  }

  return {
    port: parseInt(process.env["PORT"] ?? "4319", 10),
    apiKeys,
    rateLimit: {
      windowMs: parseInt(process.env["RATE_LIMIT_WINDOW_MS"] ?? "60000", 10),
      maxRequests: parseInt(process.env["RATE_LIMIT_MAX"] ?? "100", 10),
    },
  };
}
