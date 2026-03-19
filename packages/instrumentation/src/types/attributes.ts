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

  // Agent step attributes
  AGENT_STEP_TYPE: "gen_ai.agent.step.type",
  AGENT_STEP_NUMBER: "gen_ai.agent.step.number",
  AGENT_TOOL_NAME: "gen_ai.agent.tool.name",
  AGENT_STEP_CONTENT: "gen_ai.agent.step.content",

  // Guard (shadow mode) attributes
  GUARD_MODE: "gen_ai.toad_eye.guard.mode",
  GUARD_PASSED: "gen_ai.toad_eye.guard.passed",
  GUARD_FAILURE_REASON: "gen_ai.toad_eye.guard.failure_reason",
  GUARD_RULE_NAME: "gen_ai.toad_eye.guard.rule_name",

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
