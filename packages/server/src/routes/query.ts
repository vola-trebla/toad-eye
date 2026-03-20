// Query API — live telemetry queries for MCP tools and dashboards
// Provides: recent errors, model comparison, arbitrary metric queries

import { Hono } from "hono";

import type { MemoryStore } from "../storage/memory.js";
import type { OtlpSpan } from "../types.js";

const PERIOD_MAP: Record<string, number> = {
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

function getAttrString(span: OtlpSpan, key: string): string | undefined {
  const attr = span.attributes?.find((a) => a.key === key);
  return attr?.value.stringValue;
}

function getAttrNumber(span: OtlpSpan, key: string): number {
  const attr = span.attributes?.find((a) => a.key === key);
  if (!attr) return 0;
  if (attr.value.doubleValue !== undefined) return attr.value.doubleValue;
  if (attr.value.intValue !== undefined)
    return parseInt(attr.value.intValue, 10);
  return 0;
}

function getSpanDurationMs(span: OtlpSpan): number {
  const start = BigInt(span.startTimeUnixNano);
  const end = BigInt(span.endTimeUnixNano);
  return Number((end - start) / 1_000_000n);
}

function parsePeriod(period: string): number | undefined {
  return PERIOD_MAP[period];
}

export function createQueryRoutes(store: MemoryStore) {
  const app = new Hono();

  // GET /api/errors?limit=10&period=1d — recent errors with context
  app.get("/api/errors", (c) => {
    const limit = Math.min(parseInt(c.req.query("limit") ?? "10", 10), 100);
    const period = c.req.query("period") ?? "1d";
    const periodMs = parsePeriod(period);

    if (periodMs === undefined) {
      return c.json(
        {
          error: `Invalid period. Valid: ${Object.keys(PERIOD_MAP).join(", ")}`,
        },
        400,
      );
    }

    const allSpans = store.querySpans("", periodMs);
    const errorSpans = allSpans
      .filter((s) => getAttrString(s, "gen_ai.toad_eye.status") === "error")
      .slice(-limit)
      .reverse();

    const errors = errorSpans.map((s) => ({
      traceId: s.traceId,
      spanId: s.spanId,
      name: s.name,
      durationMs: getSpanDurationMs(s),
      error: getAttrString(s, "error.type") ?? "unknown",
      provider: getAttrString(s, "gen_ai.provider.name"),
      model: getAttrString(s, "gen_ai.request.model"),
    }));

    return c.json({ period, count: errors.length, errors });
  });

  // GET /api/models/compare?models=gpt-4o,claude-sonnet&period=7d
  app.get("/api/models/compare", (c) => {
    const modelsParam = c.req.query("models");
    const period = c.req.query("period") ?? "7d";
    const periodMs = parsePeriod(period);

    if (!modelsParam) {
      return c.json(
        { error: "Missing required parameter: models (comma-separated)" },
        400,
      );
    }

    if (periodMs === undefined) {
      return c.json(
        {
          error: `Invalid period. Valid: ${Object.keys(PERIOD_MAP).join(", ")}`,
        },
        400,
      );
    }

    const modelNames = modelsParam.split(",").map((m) => m.trim());
    const allSpans = store.querySpans("", periodMs);

    const comparison = modelNames.map((model) => {
      const spans = allSpans.filter(
        (s) => getAttrString(s, "gen_ai.request.model") === model,
      );

      if (spans.length === 0) {
        return {
          model,
          spanCount: 0,
          avgLatencyMs: 0,
          avgCost: 0,
          avgTokens: 0,
          errorRate: 0,
        };
      }

      const latencies = spans.map(getSpanDurationMs);
      const costs = spans.map((s) => getAttrNumber(s, "gen_ai.toad_eye.cost"));
      const tokens = spans.map(
        (s) =>
          getAttrNumber(s, "gen_ai.usage.input_tokens") +
          getAttrNumber(s, "gen_ai.usage.output_tokens"),
      );
      const errors = spans.filter(
        (s) => getAttrString(s, "gen_ai.toad_eye.status") === "error",
      ).length;

      const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);

      return {
        model,
        spanCount: spans.length,
        avgLatencyMs: Math.round(sum(latencies) / spans.length),
        avgCost: Number((sum(costs) / spans.length).toFixed(6)),
        avgTokens: Math.round(sum(tokens) / spans.length),
        errorRate: Number((errors / spans.length).toFixed(4)),
      };
    });

    return c.json({ period, models: comparison });
  });

  // GET /api/query?period=7d — summary of all ingested telemetry
  app.get("/api/query", (c) => {
    const period = c.req.query("period") ?? "7d";
    const periodMs = parsePeriod(period);

    if (periodMs === undefined) {
      return c.json(
        {
          error: `Invalid period. Valid: ${Object.keys(PERIOD_MAP).join(", ")}`,
        },
        400,
      );
    }

    const allSpans = store.querySpans("", periodMs);

    if (allSpans.length === 0) {
      return c.json({
        period,
        spanCount: 0,
        providers: [],
        models: [],
        totalCost: 0,
        totalTokens: 0,
        errorRate: 0,
      });
    }

    const providers = new Set<string>();
    const models = new Set<string>();
    let totalCost = 0;
    let totalTokens = 0;
    let errorCount = 0;

    for (const s of allSpans) {
      const provider = getAttrString(s, "gen_ai.provider.name");
      const model = getAttrString(s, "gen_ai.request.model");
      if (provider) providers.add(provider);
      if (model) models.add(model);
      totalCost += getAttrNumber(s, "gen_ai.toad_eye.cost");
      totalTokens +=
        getAttrNumber(s, "gen_ai.usage.input_tokens") +
        getAttrNumber(s, "gen_ai.usage.output_tokens");
      if (getAttrString(s, "gen_ai.toad_eye.status") === "error") errorCount++;
    }

    return c.json({
      period,
      spanCount: allSpans.length,
      providers: [...providers],
      models: [...models],
      totalCost: Number(totalCost.toFixed(4)),
      totalTokens,
      errorRate: Number((errorCount / allSpans.length).toFixed(4)),
    });
  });

  return app;
}
