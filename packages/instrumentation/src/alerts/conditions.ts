import type { AlertRule } from "./types.js";

// Maps OTel metric names to Prometheus metric names.
// OTel Histogram "llm.request.cost" with unit "USD" → llm_request_cost_USD_sum
// OTel Counter "llm.requests" → llm_requests_total
const METRIC_MAP: Record<string, string> = {
  "llm.request.cost": "llm_request_cost_USD_sum",
  "llm.request.duration": "llm_request_duration_ms_sum",
  "llm.requests": "llm_requests_total",
  "llm.errors": "llm_errors_total",
  "llm.tokens": "llm_tokens_total",
};

function toPromMetric(metric: string): string {
  return METRIC_MAP[metric] ?? metric.replace(/\./g, "_");
}

type ConditionOperator = "sum" | "avg" | "rate" | "max";
type Comparator = ">" | ">=" | "<" | "<=";

export interface ParsedCondition {
  readonly operator: ConditionOperator;
  readonly window: string;
  readonly comparator: Comparator;
  readonly threshold: number;
}

export function parseCondition(condition: string): ParsedCondition {
  const match =
    /^(sum|avg|rate|max)_(\d+[smhd])\s*(>=|<=|>|<)\s*([\d.]+)$/.exec(
      condition.trim(),
    );
  if (!match) {
    throw new Error(
      `Invalid alert condition: "${condition}". Expected format: "sum_1h > 10"`,
    );
  }
  return {
    operator: match[1] as ConditionOperator,
    window: match[2]!,
    comparator: match[3] as Comparator,
    threshold: parseFloat(match[4]!),
  };
}

function buildPromQL(
  metric: string,
  operator: ConditionOperator,
  window: string,
): string {
  const m = toPromMetric(metric);
  switch (operator) {
    case "sum":
      return `sum(increase(${m}[${window}]))`;
    case "avg":
      return `avg(rate(${m}[${window}])) * 60`;
    case "rate":
      return `sum(rate(${m}[${window}])) * 60`;
    case "max":
      return `max(increase(${m}[${window}]))`;
  }
}

function buildTopModelsQuery(metric: string, window: string): string {
  const m = toPromMetric(metric);
  return `topk(5, sum by (model) (increase(${m}[${window}])))`;
}

function matches(
  value: number,
  comparator: Comparator,
  threshold: number,
): boolean {
  switch (comparator) {
    case ">":
      return value > threshold;
    case ">=":
      return value >= threshold;
    case "<":
      return value < threshold;
    case "<=":
      return value <= threshold;
  }
}

async function queryScalar(
  prometheusUrl: string,
  promql: string,
): Promise<number> {
  const url = `${prometheusUrl}/api/v1/query?query=${encodeURIComponent(promql)}`;
  const res = await fetch(url);
  if (!res.ok)
    throw new Error(`Prometheus query failed: ${res.status} ${res.statusText}`);
  const data = (await res.json()) as {
    data: { result: Array<{ value: [number, string] }> };
  };
  const first = data.data.result[0];
  return first ? parseFloat(first.value[1]) : 0;
}

async function queryTopModels(
  prometheusUrl: string,
  metric: string,
  window: string,
): Promise<Array<{ model: string; value: number }>> {
  const promql = buildTopModelsQuery(metric, window);
  const url = `${prometheusUrl}/api/v1/query?query=${encodeURIComponent(promql)}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = (await res.json()) as {
    data: {
      result: Array<{ metric: { model?: string }; value: [number, string] }>;
    };
  };
  return data.data.result
    .map((r) => ({
      model: r.metric.model ?? "unknown",
      value: parseFloat(r.value[1]),
    }))
    .sort((a, b) => b.value - a.value);
}

export interface EvalResult {
  readonly triggered: boolean;
  readonly value: number;
  readonly threshold: number;
  readonly topModels: Array<{ model: string; value: number }>;
}

export async function evaluateCondition(
  prometheusUrl: string,
  rule: AlertRule,
): Promise<EvalResult | null> {
  try {
    const { operator, window, comparator, threshold } = parseCondition(
      rule.condition,
    );
    const promql = buildPromQL(rule.metric, operator, window);
    const value = await queryScalar(prometheusUrl, promql);
    const triggered = matches(value, comparator, threshold);
    const topModels = triggered
      ? await queryTopModels(prometheusUrl, rule.metric, window)
      : [];
    return { triggered, value, threshold, topModels };
  } catch (err) {
    console.error(`[toad-eye alerts] Failed to evaluate "${rule.name}":`, err);
    return null;
  }
}
