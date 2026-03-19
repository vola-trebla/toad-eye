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
