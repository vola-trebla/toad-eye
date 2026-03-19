/**
 * Span attribute keys following OTel GenAI semantic conventions.
 * See: https://opentelemetry.io/docs/specs/semconv/gen-ai/
 *
 * Standard attributes use `gen_ai.*` prefix.
 * toad-eye extensions use `gen_ai.toad_eye.*` prefix.
 */
export const GEN_AI_ATTRS = {
  // OTel GenAI standard
  PROVIDER: "gen_ai.provider.name",
  REQUEST_MODEL: "gen_ai.request.model",
  RESPONSE_MODEL: "gen_ai.response.model",
  INPUT_TOKENS: "gen_ai.usage.input_tokens",
  OUTPUT_TOKENS: "gen_ai.usage.output_tokens",
  TEMPERATURE: "gen_ai.request.temperature",
  OPERATION: "gen_ai.operation.name",
  FINISH_REASONS: "gen_ai.response.finish_reasons",
  ERROR: "error.type",

  // toad-eye extensions
  PROMPT: "gen_ai.toad_eye.prompt",
  COMPLETION: "gen_ai.toad_eye.completion",
  COST: "gen_ai.toad_eye.cost",
  STATUS: "gen_ai.toad_eye.status",
  SESSION_ID: "session.id",
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
