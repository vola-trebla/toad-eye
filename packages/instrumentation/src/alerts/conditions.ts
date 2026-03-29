import type { AlertRule } from "./types.js";

// Maps OTel metric names to Prometheus metric names.
const METRIC_MAP: Record<string, string> = {
  "gen_ai.client.request.cost": "gen_ai_client_request_cost_USD_sum",
  "gen_ai.client.operation.duration":
    "gen_ai_client_operation_duration_milliseconds",
  "gen_ai.client.requests": "gen_ai_client_requests_total",
  "gen_ai.client.errors": "gen_ai_client_errors_total",
  "gen_ai.client.token.usage": "gen_ai_client_token_usage_total",
  // MCP metrics
  "gen_ai.mcp.tool.calls": "gen_ai_mcp_tool_calls_total",
  "gen_ai.mcp.tool.errors": "gen_ai_mcp_tool_errors_total",
  "gen_ai.mcp.tool.duration": "gen_ai_mcp_tool_duration",
  "gen_ai.mcp.resource.reads": "gen_ai_mcp_resource_reads_total",
  "gen_ai.mcp.tool.callers": "gen_ai_mcp_tool_callers_total",
  // Legacy names (backward compat)
  "llm.request.cost": "gen_ai_client_request_cost_USD_sum",
  "llm.request.duration": "gen_ai_client_operation_duration_milliseconds",
  "llm.requests": "gen_ai_client_requests_total",
  "llm.errors": "gen_ai_client_errors_total",
  "llm.tokens": "gen_ai_client_token_usage_total",
};

function toPromMetric(metric: string): string {
  return METRIC_MAP[metric] ?? metric.replace(/\./g, "_");
}

function isMcpMetric(metric: string): boolean {
  return metric.startsWith("gen_ai.mcp.");
}

type ConditionOperator = "sum" | "avg" | "rate" | "max" | "p95_pct" | "ratio";
type Comparator = ">" | ">=" | "<" | "<=";

export interface ParsedCondition {
  readonly operator: ConditionOperator;
  readonly window: string;
  readonly baselineWindow?: string | undefined;
  readonly comparator: Comparator;
  readonly threshold: number;
}

/**
 * Parse condition string into structured form.
 *
 * Standard: "sum_1h > 10", "rate_5m > 0.05"
 * Baseline: "p95_pct_5m_7d > 50" — p95 over 5m increased >50% vs 7d baseline
 * Ratio:    "ratio_15m > 0.05"   — errors/requests ratio over 15m
 */
export function parseCondition(condition: string): ParsedCondition {
  // Baseline percentage: p95_pct_<window>_<baseline> <cmp> <threshold>
  const baselineMatch =
    /^p95_pct_(\d+[smhd])_(\d+[smhd])\s*(>=|<=|>|<)\s*([\d.]+)$/.exec(
      condition.trim(),
    );
  if (baselineMatch) {
    return {
      operator: "p95_pct",
      window: baselineMatch[1]!,
      baselineWindow: baselineMatch[2]!,
      comparator: baselineMatch[3] as Comparator,
      threshold: parseFloat(baselineMatch[4]!),
    };
  }

  // Standard: sum_1h > 10, ratio_15m > 0.05
  const match =
    /^(sum|avg|rate|max|ratio)_(\d+[smhd])\s*(>=|<=|>|<)\s*([\d.]+)$/.exec(
      condition.trim(),
    );
  if (!match) {
    throw new Error(
      `Invalid alert condition: "${condition}". Expected format: "sum_1h > 10" or "p95_pct_5m_7d > 50"`,
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
    case "p95_pct":
    case "ratio":
      // Handled separately in evaluateCondition
      return "";
  }
}

function buildTopModelsQuery(metric: string, window: string): string {
  const m = toPromMetric(metric);
  const groupBy = isMcpMetric(metric)
    ? "gen_ai_tool_name"
    : "gen_ai_request_model";
  return `topk(5, sum by (${groupBy}) (increase(${m}[${window}])))`;
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
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
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
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return [];
  const labelKey = isMcpMetric(metric)
    ? "gen_ai_tool_name"
    : "gen_ai_request_model";
  const data = (await res.json()) as {
    data: {
      result: Array<{
        metric: Record<string, string>;
        value: [number, string];
      }>;
    };
  };
  return data.data.result
    .map((r) => ({
      model: r.metric[labelKey] ?? "unknown",
      value: parseFloat(r.value[1]),
    }))
    .sort((a, b) => b.value - a.value);
}

/** Evaluate p95 current vs baseline, return % increase */
async function evalP95Baseline(
  prometheusUrl: string,
  metric: string,
  window: string,
  baselineWindow: string,
): Promise<number> {
  const m = toPromMetric(metric);
  const bucketMetric = `${m}_bucket`;
  const currentP95 = await queryScalar(
    prometheusUrl,
    `histogram_quantile(0.95, sum(rate(${bucketMetric}[${window}])) by (le))`,
  );
  const baselineP95 = await queryScalar(
    prometheusUrl,
    `histogram_quantile(0.95, sum(rate(${bucketMetric}[${baselineWindow}])) by (le))`,
  );
  if (baselineP95 === 0) return 0;
  return ((currentP95 - baselineP95) / baselineP95) * 100;
}

/** Evaluate error ratio: errors / requests over window */
async function evalErrorRatio(
  prometheusUrl: string,
  metric: string,
  window: string,
): Promise<number> {
  let errorMetric: string;
  let requestMetric: string;

  if (isMcpMetric(metric)) {
    errorMetric = "gen_ai_mcp_tool_errors_total";
    requestMetric = "gen_ai_mcp_tool_calls_total";
  } else {
    errorMetric = "gen_ai_client_errors_total";
    requestMetric = "gen_ai_client_requests_total";
  }

  const errors = await queryScalar(
    prometheusUrl,
    `sum(increase(${errorMetric}[${window}]))`,
  );
  const requests = await queryScalar(
    prometheusUrl,
    `sum(increase(${requestMetric}[${window}]))`,
  );
  if (requests === 0) return 0;
  return errors / requests;
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
    const parsed = parseCondition(rule.condition);
    let value: number;

    if (parsed.operator === "p95_pct") {
      value = await evalP95Baseline(
        prometheusUrl,
        rule.metric,
        parsed.window,
        parsed.baselineWindow!,
      );
    } else if (parsed.operator === "ratio") {
      value = await evalErrorRatio(prometheusUrl, rule.metric, parsed.window);
    } else {
      const promql = buildPromQL(rule.metric, parsed.operator, parsed.window);
      value = await queryScalar(prometheusUrl, promql);
    }

    const triggered = matches(value, parsed.comparator, parsed.threshold);
    const topModels = triggered
      ? await queryTopModels(prometheusUrl, rule.metric, parsed.window)
      : [];
    return { triggered, value, threshold: parsed.threshold, topModels };
  } catch (err) {
    console.error(`[toad-eye alerts] Failed to evaluate "${rule.name}":`, err);
    return null;
  }
}
