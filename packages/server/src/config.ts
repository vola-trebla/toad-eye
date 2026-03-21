// Server configuration — reads from environment variables with sensible defaults

import type { ServerConfig } from "./types.js";

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(
      `toad-eye server: invalid ${name}="${raw}" — must be a number`,
    );
  }
  return parsed;
}

export function loadConfig(): ServerConfig {
  const apiKeysRaw = process.env["TOAD_API_KEYS"] ?? "";
  const apiKeys = apiKeysRaw
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0);

  if (apiKeys.length === 0) {
    const devKey = "toad_dev_" + Math.random().toString(36).slice(2, 10);
    apiKeys.push(devKey);
    console.log(`No TOAD_API_KEYS set. Generated dev key: ${devKey}`);
  }

  return {
    port: parseIntEnv("PORT", 4319),
    apiKeys,
    rateLimit: {
      windowMs: parseIntEnv("RATE_LIMIT_WINDOW_MS", 60000),
      maxRequests: parseIntEnv("RATE_LIMIT_MAX", 100),
    },
  };
}
