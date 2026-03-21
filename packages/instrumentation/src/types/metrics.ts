/**
 * Metric names exported to Prometheus via OTel.
 *
 * Naming follows OTel GenAI semantic conventions:
 * - `gen_ai.client.*` prefix for client-side metrics
 * - Prometheus auto-converts dots to underscores
 * - Prometheus adds _total suffix to counters automatically
 */
export const GEN_AI_METRICS = {
  REQUEST_DURATION: "gen_ai.client.operation.duration",
  TOKEN_USAGE: "gen_ai.client.token.usage",
  REQUEST_COST: "gen_ai.client.request.cost",
  REQUESTS: "gen_ai.client.requests",
  ERRORS: "gen_ai.client.errors",
  // Agent metrics
  AGENT_STEPS_PER_QUERY: "gen_ai.agent.steps_per_query",
  AGENT_TOOL_USAGE: "gen_ai.agent.tool_usage",
  // Guard metrics
  GUARD_EVALUATIONS: "gen_ai.toad_eye.guard.evaluations",
  GUARD_WOULD_BLOCK: "gen_ai.toad_eye.guard.would_block",
  // Drift metrics
  SEMANTIC_DRIFT: "gen_ai.toad_eye.semantic_drift",
  // Streaming metrics
  TIME_TO_FIRST_TOKEN: "gen_ai.client.time_to_first_token",
  // Budget metrics
  BUDGET_EXCEEDED: "gen_ai.toad_eye.budget.exceeded",
  BUDGET_BLOCKED: "gen_ai.toad_eye.budget.blocked",
  BUDGET_DOWNGRADED: "gen_ai.toad_eye.budget.downgraded",
} as const;

/** @deprecated Use GEN_AI_METRICS instead. Kept for backward compatibility. */
export const LLM_METRICS = {
  REQUEST_DURATION: GEN_AI_METRICS.REQUEST_DURATION,
  REQUEST_COST: GEN_AI_METRICS.REQUEST_COST,
  TOKENS: GEN_AI_METRICS.TOKEN_USAGE,
  REQUESTS: GEN_AI_METRICS.REQUESTS,
  ERRORS: GEN_AI_METRICS.ERRORS,
} as const;

/** Type-safe metric name — only values from GEN_AI_METRICS are allowed. */
export type MetricName = (typeof GEN_AI_METRICS)[keyof typeof GEN_AI_METRICS];
