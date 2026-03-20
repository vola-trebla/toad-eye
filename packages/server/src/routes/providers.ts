// Provider Health API — monitor LLM provider availability and degradation
// Auto-detects status from error rates: healthy / degraded / down

import { Hono } from "hono";

import type { MemoryStore } from "../storage/memory.js";
import type { OtlpSpan } from "../types.js";

type ProviderStatus = "healthy" | "degraded" | "down" | "no_data";

interface ProviderHealth {
  readonly provider: string;
  readonly status: ProviderStatus;
  readonly errorRate: number;
  readonly totalRequests: number;
  readonly totalErrors: number;
  readonly rateLimitErrors: number;
  readonly timeoutErrors: number;
}

const DEGRADED_THRESHOLD = 0.1; // 10% error rate
const DOWN_THRESHOLD = 0.5; // 50% error rate

function getAttrString(span: OtlpSpan, key: string): string | undefined {
  const attr = span.attributes?.find((a) => a.key === key);
  return attr?.value.stringValue;
}

function classifyError(errorType: string): "rate_limit" | "timeout" | "other" {
  const lower = errorType.toLowerCase();
  if (
    lower.includes("rate_limit") ||
    lower.includes("429") ||
    lower.includes("quota")
  ) {
    return "rate_limit";
  }
  if (
    lower.includes("timeout") ||
    lower.includes("timed out") ||
    lower.includes("deadline")
  ) {
    return "timeout";
  }
  return "other";
}

function determineStatus(
  errorRate: number,
  rateLimitRate: number,
  timeoutRate: number,
): ProviderStatus {
  if (timeoutRate > DOWN_THRESHOLD) return "down";
  if (errorRate > DOWN_THRESHOLD) return "down";
  if (rateLimitRate > DEGRADED_THRESHOLD) return "degraded";
  if (errorRate > DEGRADED_THRESHOLD) return "degraded";
  return "healthy";
}

const PERIOD_MAP: Record<string, number> = {
  "5m": 5 * 60 * 1000,
  "15m": 15 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

export function createProviderRoutes(store: MemoryStore) {
  const app = new Hono();

  // GET /api/providers/health?period=5m
  app.get("/api/providers/health", (c) => {
    const period = c.req.query("period") ?? "5m";
    const periodMs = PERIOD_MAP[period];

    if (periodMs === undefined) {
      return c.json(
        {
          error: `Invalid period. Valid: ${Object.keys(PERIOD_MAP).join(", ")}`,
        },
        400,
      );
    }

    const allSpans = store.querySpans("", periodMs);

    // Group by provider
    const byProvider = new Map<string, OtlpSpan[]>();
    for (const span of allSpans) {
      const provider = getAttrString(span, "gen_ai.provider.name") ?? "unknown";
      const list = byProvider.get(provider);
      if (list) {
        list.push(span);
      } else {
        byProvider.set(provider, [span]);
      }
    }

    const providers: ProviderHealth[] = [...byProvider.entries()].map(
      ([provider, spans]) => {
        const errors = spans.filter(
          (s) => getAttrString(s, "gen_ai.toad_eye.status") === "error",
        );
        const rateLimitErrors = errors.filter((s) => {
          const errType = getAttrString(s, "error.type") ?? "";
          return classifyError(errType) === "rate_limit";
        }).length;
        const timeoutErrors = errors.filter((s) => {
          const errType = getAttrString(s, "error.type") ?? "";
          return classifyError(errType) === "timeout";
        }).length;

        const errorRate = spans.length > 0 ? errors.length / spans.length : 0;
        const rateLimitRate =
          spans.length > 0 ? rateLimitErrors / spans.length : 0;
        const timeoutRate = spans.length > 0 ? timeoutErrors / spans.length : 0;

        return {
          provider,
          status: determineStatus(errorRate, rateLimitRate, timeoutRate),
          errorRate: Number(errorRate.toFixed(4)),
          totalRequests: spans.length,
          totalErrors: errors.length,
          rateLimitErrors,
          timeoutErrors,
        };
      },
    );

    return c.json({ period, providers });
  });

  return app;
}
