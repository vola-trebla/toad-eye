#!/usr/bin/env npx tsx
/**
 * Validate Grafana dashboard PromQL queries against known metric names.
 *
 * Extracts all Prometheus metric names from dashboard JSON files and checks
 * them against the set of metrics that toad-eye actually emits. Catches
 * typos, missing unit suffixes, and wrong label names before they reach
 * production.
 *
 * Usage: npx tsx scripts/validate-dashboards.ts
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DASHBOARDS_DIR = "packages/instrumentation/templates/grafana/dashboards";

// All Prometheus metric names that toad-eye emits.
// Derived from GEN_AI_METRICS + metric types + units.
const KNOWN_METRICS = new Set([
  // Histograms (unit: ms) → _milliseconds_sum, _count, _bucket
  "gen_ai_client_operation_duration_milliseconds",
  "gen_ai_client_time_to_first_token_milliseconds",
  "gen_ai_agent_steps_per_query",
  "gen_ai_agent_tool_duration_milliseconds",
  "gen_ai_toad_eye_semantic_drift",
  "gen_ai_toad_eye_response_latency_per_token",
  "gen_ai_toad_eye_context_utilization",
  "gen_ai_mcp_tool_duration",
  // Histograms (unit: USD) → _USD_sum, _count, _bucket
  "gen_ai_client_request_cost_USD",
  // Histograms (no unit)
  "gen_ai_toad_eye_thinking_ratio",
  // Counters → _total
  "gen_ai_client_token_usage_total",
  "gen_ai_client_requests_total",
  "gen_ai_client_errors_total",
  "gen_ai_agent_tool_usage_total",
  "gen_ai_toad_eye_guard_evaluations_total",
  "gen_ai_toad_eye_guard_would_block_total",
  "gen_ai_toad_eye_budget_exceeded_total",
  "gen_ai_toad_eye_budget_blocked_total",
  "gen_ai_toad_eye_budget_downgraded_total",
  "gen_ai_toad_eye_response_empty_total",
  "gen_ai_toad_eye_context_blocked_total",
  "gen_ai_mcp_tool_calls_total",
  "gen_ai_mcp_tool_errors_total",
  "gen_ai_mcp_resource_reads_total",
  "gen_ai_mcp_tool_callers_total",
  "gen_ai_mcp_tool_hallucinations_total",
  // UpDownCounter (no suffix)
  "gen_ai_mcp_session_active",
]);

// All known Prometheus label names (OTel dots → underscores)
const KNOWN_LABELS = new Set([
  "gen_ai_request_model",
  "gen_ai_provider_name",
  "gen_ai_tool_name",
  "gen_ai_data_source_id",
  "gen_ai_prompt_name",
  "gen_ai_operation_name",
  "gen_ai_agent_step_type",
  "mcp_method_name",
  "mcp_session_id",
  "mcp_server_name",
  "network_transport",
  "error_type",
  "status",
  "job",
  "le", // histogram bucket label
  // FinOps attribution labels (user-provided via config.attributes)
  "toad_eye_team",
  "toad_eye_feature",
  "toad_eye_user_id",
  "toad_eye_environment",
]);

// Extract metric names from PromQL expressions (not labels)
function extractMetricNames(expr: string): string[] {
  // Strip label selectors and by-clauses to avoid matching label names as metrics
  // Note: JSON-escaped exprs have \" inside {} so we need a greedy-enough pattern
  const stripped = expr
    .replace(/\{[^}]*?\}/g, "") // remove {label=value} (handles escaped quotes)
    .replace(/by\s*\([^)]*\)/g, "") // remove by (label, label)
    .replace(/label_values\([^,]+,\s*[^)]+\)/g, (m) => {
      // from label_values(metric, label) — keep only metric
      const metric = m.match(/label_values\(([^,]+)/)?.[1]?.trim() ?? "";
      return metric;
    });

  const metricPattern = /\b(gen_ai_\w+)/g;
  const matches: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = metricPattern.exec(stripped)) !== null) {
    matches.push(m[1]!);
  }
  return matches;
}

// Extract label names from PromQL expressions
function extractLabelNames(expr: string): string[] {
  // Match "by (label1, label2)" and "{label=..."
  const byPattern = /by\s*\(([^)]+)\)/g;
  const filterPattern = /\{([^}]+)\}/g;
  const labels: string[] = [];

  let m: RegExpExecArray | null;
  while ((m = byPattern.exec(expr)) !== null) {
    labels.push(...m[1]!.split(",").map((l) => l.trim().replace(/[()]/g, "")));
  }
  while ((m = filterPattern.exec(expr)) !== null) {
    const pairs = m[1]!.split(",");
    for (const pair of pairs) {
      const label = pair.split(/[=~!]/)[0]?.trim();
      if (label) labels.push(label);
    }
  }
  return labels.filter((l) => !l.startsWith("$") && l.length > 0);
}

// Normalize metric name — strip histogram suffixes to get base name
function normalizeMetric(name: string): string {
  return name
    .replace(/_bucket$/, "")
    .replace(/_sum$/, "")
    .replace(/_count$/, "")
    .replace(/_total$/, "");
}

let errors = 0;
let warnings = 0;

const files = readdirSync(DASHBOARDS_DIR).filter((f) => f.endsWith(".json"));

for (const file of files) {
  const path = join(DASHBOARDS_DIR, file);
  const content = readFileSync(path, "utf-8");
  const dashboard = JSON.parse(content);

  // Extract all expr values from parsed JSON (handles escaped quotes correctly)
  const exprs: Array<{ expr: string; panel: string }> = [];

  function walk(obj: unknown, panelTitle = "root") {
    if (obj === null || typeof obj !== "object") return;
    if (Array.isArray(obj)) {
      for (const item of obj) walk(item, panelTitle);
      return;
    }
    const rec = obj as Record<string, unknown>;
    const title = (rec.title as string) ?? panelTitle;
    if (typeof rec.expr === "string") {
      exprs.push({ expr: rec.expr, panel: title });
    }
    if (typeof rec.query === "string" && rec.query.includes("label_values")) {
      exprs.push({ expr: rec.query, panel: title });
    }
    for (const v of Object.values(rec)) walk(v, title);
  }

  walk(dashboard);

  for (const { expr, panel } of exprs) {
    const metrics = extractMetricNames(expr);
    for (const metric of metrics) {
      const base = normalizeMetric(metric);
      if (!KNOWN_METRICS.has(metric) && !KNOWN_METRICS.has(base)) {
        console.error(`❌ ${file} [${panel}] — unknown metric "${metric}"`);
        errors++;
      }
    }

    const labels = extractLabelNames(expr);
    for (const label of labels) {
      if (!KNOWN_LABELS.has(label)) {
        console.warn(`⚠️  ${file} [${panel}] — unknown label "${label}"`);
        warnings++;
      }
    }
  }
}

console.log(
  `\n${files.length} dashboards scanned. ${errors} errors, ${warnings} warnings.`,
);

if (errors > 0) {
  console.error("\n❌ Dashboard validation failed.");
  process.exit(1);
}

if (warnings > 0) {
  console.log("\n⚠️  Warnings found — review manually.");
} else {
  console.log("\n✅ All dashboard queries use known metrics and labels.");
}
