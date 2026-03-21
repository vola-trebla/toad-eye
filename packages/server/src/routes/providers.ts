// Provider Health API — monitor LLM provider availability and degradation
// Auto-detects status from error rates: healthy / degraded / down

import { Hono } from "hono";

import type { MemoryStore } from "../storage/memory.js";
import type { OtlpSpan } from "../types.js";
import { getAttrString } from "../utils/span-helpers.js";
import { parsePeriod, periodError } from "../utils/periods.js";

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

const DEGRADED_THRESHOLD = 0.1;
const DOWN_THRESHOLD = 0.5;

const RATE_LIMIT_RE = /rate_limit|429|quota/i;
const TIMEOUT_RE = /timeout|timed out|deadline/i;

function classifyError(errorType: string): "rate_limit" | "timeout" | "other" {
  if (RATE_LIMIT_RE.test(errorType)) return "rate_limit";
  if (TIMEOUT_RE.test(errorType)) return "timeout";
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

export function createProviderRoutes(store: MemoryStore) {
  const app = new Hono();

  app.get("/api/providers/health", (c) => {
    const period = c.req.query("period") ?? "5m";
    const periodMs = parsePeriod(period);

    if (periodMs === undefined) {
      return c.json({ error: periodError() }, 400);
    }

    const allSpans = store.querySpans("", periodMs);

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
