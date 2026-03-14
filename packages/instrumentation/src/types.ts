/**
 * LLM providers supported by toad-eye
 */
export type LLMProvider = "anthropic" | "gemini" | "openai";

/**
 * Span status
 */
export type SpanStatus = "success" | "error";

/**
 * Attributes attached to every LLM span (trace).
 * These become searchable fields in Jaeger and filterable dimensions in Grafana.
 */
export interface LLMSpanAttributes {
  readonly provider: LLMProvider;
  readonly model: string;
  readonly prompt: string;
  readonly completion: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cost: number;
  readonly temperature: number;
  readonly status: SpanStatus;
  readonly error?: string | undefined;
}

/**
 * Metric names exported to Prometheus.
 *
 * Naming convention follows OpenTelemetry semantic conventions:
 * - dots as separators: "llm.request.duration"
 * - unit in the name where ambiguous: "llm.tokens.total"
 * - Prometheus auto-converts dots to underscores: llm_request_duration
 */
export const LLM_METRICS = {
  REQUEST_DURATION: "llm.request.duration",
  REQUEST_COST: "llm.request.cost",
  TOKENS_TOTAL: "llm.tokens.total",
  REQUESTS_TOTAL: "llm.requests.total",
  ERRORS_TOTAL: "llm.errors.total",
} as const;

/**
 * Type-safe metric name — only values from LLM_METRICS are allowed
 */
export type MetricName = (typeof LLM_METRICS)[keyof typeof LLM_METRICS];

/**
 * Configuration for initObservability().
 * This is what the user passes when connecting toad-eye to their service.
 */
export interface ToadEyeConfig {
  readonly serviceName: string;
  readonly endpoint?: string | undefined;
  readonly recordContent?: boolean | undefined;
}
