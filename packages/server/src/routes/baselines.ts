// Baselines API — compute production baselines from ingested telemetry
// Used by toad-ci for quality gates: if new prompt is slower/costlier than baseline → CI fails

import { Hono } from "hono";

import type { MemoryStore } from "../storage/memory.js";
import type { OtlpSpan } from "../types.js";

/** Baseline stats computed from span data. */
interface BaselineResponse {
  readonly prompt: string;
  readonly period: string;
  readonly spanCount: number;
  readonly avgLatencyMs: number;
  readonly p95LatencyMs: number;
  readonly avgCost: number;
  readonly avgTokens: number;
  readonly errorRate: number;
}

const PERIOD_MAP: Record<string, number> = {
  "1d": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "14d": 14 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

function getSpanDurationMs(span: OtlpSpan): number {
  const start = BigInt(span.startTimeUnixNano);
  const end = BigInt(span.endTimeUnixNano);
  return Number((end - start) / 1_000_000n);
}

function getAttrNumber(span: OtlpSpan, key: string): number {
  const attr = span.attributes?.find((a) => a.key === key);
  if (!attr) return 0;
  if (attr.value.doubleValue !== undefined) return attr.value.doubleValue;
  if (attr.value.intValue !== undefined)
    return parseInt(attr.value.intValue, 10);
  return 0;
}

function getAttrString(span: OtlpSpan, key: string): string | undefined {
  const attr = span.attributes?.find((a) => a.key === key);
  return attr?.value.stringValue;
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)] ?? 0;
}

function computeBaseline(
  spans: readonly OtlpSpan[],
  prompt: string,
  period: string,
): BaselineResponse {
  if (spans.length === 0) {
    return {
      prompt,
      period,
      spanCount: 0,
      avgLatencyMs: 0,
      p95LatencyMs: 0,
      avgCost: 0,
      avgTokens: 0,
      errorRate: 0,
    };
  }

  const latencies = spans.map(getSpanDurationMs).sort((a, b) => a - b);
  const costs = spans.map((s) => getAttrNumber(s, "gen_ai.toad_eye.cost"));
  const tokens = spans.map(
    (s) =>
      getAttrNumber(s, "gen_ai.usage.input_tokens") +
      getAttrNumber(s, "gen_ai.usage.output_tokens"),
  );
  const errors = spans.filter(
    (s) => getAttrString(s, "gen_ai.toad_eye.status") === "error",
  ).length;

  const sum = (arr: readonly number[]) => arr.reduce((a, b) => a + b, 0);

  return {
    prompt,
    period,
    spanCount: spans.length,
    avgLatencyMs: Math.round(sum(latencies) / spans.length),
    p95LatencyMs: Math.round(percentile(latencies, 95)),
    avgCost: Number((sum(costs) / spans.length).toFixed(6)),
    avgTokens: Math.round(sum(tokens) / spans.length),
    errorRate: Number((errors / spans.length).toFixed(4)),
  };
}

export function createBaselineRoutes(store: MemoryStore) {
  const app = new Hono();

  // GET /api/baselines?prompt={name}&period=7d
  app.get("/api/baselines", (c) => {
    const prompt = c.req.query("prompt");
    const period = c.req.query("period") ?? "7d";

    if (!prompt) {
      return c.json({ error: "Missing required query parameter: prompt" }, 400);
    }

    const periodMs = PERIOD_MAP[period];
    if (periodMs === undefined) {
      return c.json(
        {
          error: `Invalid period: ${period}. Valid values: ${Object.keys(PERIOD_MAP).join(", ")}`,
        },
        400,
      );
    }

    const spans = store.querySpans(prompt, periodMs);
    const baseline = computeBaseline(spans, prompt, period);

    return c.json(baseline);
  });

  return app;
}
