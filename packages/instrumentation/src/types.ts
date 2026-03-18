export const INSTRUMENTATION_NAME = "toad-eye";

/**
 * LLM providers supported by toad-eye.
 * Values follow OTel GenAI semconv `gen_ai.provider.name`.
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
 * Naming follows OTel GenAI semantic conventions where possible:
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

/**
 * Span attribute keys following OTel GenAI semantic conventions.
 * See: https://opentelemetry.io/docs/specs/semconv/gen-ai/
 */
export const GEN_AI_ATTRS = {
  PROVIDER: "gen_ai.provider.name",
  REQUEST_MODEL: "gen_ai.request.model",
  RESPONSE_MODEL: "gen_ai.response.model",
  INPUT_TOKENS: "gen_ai.usage.input_tokens",
  OUTPUT_TOKENS: "gen_ai.usage.output_tokens",
  TEMPERATURE: "gen_ai.request.temperature",
  OPERATION: "gen_ai.operation.name",
  FINISH_REASONS: "gen_ai.response.finish_reasons",
  // Not in OTel semconv yet — toad-eye extensions
  PROMPT: "gen_ai.toad_eye.prompt",
  COMPLETION: "gen_ai.toad_eye.completion",
  COST: "gen_ai.toad_eye.cost",
  STATUS: "gen_ai.toad_eye.status",
  ERROR: "error.type",
} as const;

/** @deprecated Use GEN_AI_ATTRS instead. Kept for backward compatibility. */
export const LLM_ATTRS = {
  PROVIDER: GEN_AI_ATTRS.PROVIDER,
  MODEL: GEN_AI_ATTRS.REQUEST_MODEL,
  PROMPT: GEN_AI_ATTRS.PROMPT,
  COMPLETION: GEN_AI_ATTRS.COMPLETION,
  INPUT_TOKENS: GEN_AI_ATTRS.INPUT_TOKENS,
  OUTPUT_TOKENS: GEN_AI_ATTRS.OUTPUT_TOKENS,
  COST: GEN_AI_ATTRS.COST,
  TEMPERATURE: GEN_AI_ATTRS.TEMPERATURE,
  STATUS: GEN_AI_ATTRS.STATUS,
  ERROR: GEN_AI_ATTRS.ERROR,
} as const;

/**
 * Type-safe metric name
 */
export type MetricName = (typeof GEN_AI_METRICS)[keyof typeof GEN_AI_METRICS];

/**
 * Configuration for initObservability().
 */
export interface ToadEyeConfig {
  readonly serviceName: string;
  readonly endpoint?: string | undefined;
  readonly recordContent?: boolean | undefined;
  readonly instrument?: readonly LLMProvider[] | undefined;
}
