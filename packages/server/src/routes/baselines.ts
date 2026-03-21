// Baselines API — compute production baselines from ingested telemetry
// Used by toad-ci for quality gates: if new prompt is slower/costlier than baseline → CI fails

import { Hono } from "hono";

import type { MemoryStore } from "../storage/memory.js";
import type { OtlpSpan } from "../types.js";
import {
  getAttrString,
  getAttrNumber,
  getSpanDurationMs,
  percentile,
  sumArray,
} from "../utils/span-helpers.js";
import { parsePeriod, periodError } from "../utils/periods.js";

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

  return {
    prompt,
    period,
    spanCount: spans.length,
    avgLatencyMs: Math.round(sumArray(latencies) / spans.length),
    p95LatencyMs: Math.round(percentile(latencies, 95)),
    avgCost: Number((sumArray(costs) / spans.length).toFixed(6)),
    avgTokens: Math.round(sumArray(tokens) / spans.length),
    errorRate: Number((errors / spans.length).toFixed(4)),
  };
}

export function createBaselineRoutes(store: MemoryStore) {
  const app = new Hono();

  app.get("/api/baselines", (c) => {
    const prompt = c.req.query("prompt");
    const period = c.req.query("period") ?? "7d";

    if (!prompt) {
      return c.json({ error: "Missing required query parameter: prompt" }, 400);
    }

    const periodMs = parsePeriod(period);
    if (periodMs === undefined) {
      return c.json({ error: periodError() }, 400);
    }

    const spans = store.querySpans(prompt, periodMs);
    const baseline = computeBaseline(spans, prompt, period);

    return c.json(baseline);
  });

  return app;
}
