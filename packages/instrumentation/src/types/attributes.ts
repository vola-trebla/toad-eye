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

  // OTel GenAI agent attributes
  AGENT_NAME: "gen_ai.agent.name",
  AGENT_ID: "gen_ai.agent.id",
  TOOL_NAME: "gen_ai.tool.name",
  TOOL_TYPE: "gen_ai.tool.type",

  // toad-eye ReAct extensions (gen_ai.toad_eye.agent.* — correct namespace)
  TOAD_AGENT_STEP_TYPE: "gen_ai.toad_eye.agent.step.type",
  TOAD_AGENT_STEP_NUMBER: "gen_ai.toad_eye.agent.step.number",
  TOAD_AGENT_STEP_CONTENT: "gen_ai.toad_eye.agent.step.content",
  TOAD_AGENT_HANDOFF_TO: "gen_ai.toad_eye.agent.handoff.to",
  TOAD_AGENT_HANDOFF_REASON: "gen_ai.toad_eye.agent.handoff.reason",
  TOAD_AGENT_LOOP_COUNT: "gen_ai.toad_eye.agent.loop_count",

  // Agent step attributes — @deprecated aliases (will be removed in v3.0)
  /** @deprecated Use TOAD_AGENT_STEP_TYPE instead. Will be removed in v3.0. */
  AGENT_STEP_TYPE: "gen_ai.agent.step.type",
  /** @deprecated Use TOAD_AGENT_STEP_NUMBER instead. Will be removed in v3.0. */
  AGENT_STEP_NUMBER: "gen_ai.agent.step.number",
  /** @deprecated Use TOOL_NAME instead. Will be removed in v3.0. */
  AGENT_TOOL_NAME: "gen_ai.agent.tool.name",
  /** @deprecated Use TOAD_AGENT_STEP_CONTENT instead. Will be removed in v3.0. */
  AGENT_STEP_CONTENT: "gen_ai.agent.step.content",
  /** @deprecated Use TOAD_AGENT_HANDOFF_TO instead. Will be removed in v3.0. */
  AGENT_HANDOFF_TO: "gen_ai.agent.handoff.to",
  /** @deprecated Use TOAD_AGENT_HANDOFF_REASON instead. Will be removed in v3.0. */
  AGENT_HANDOFF_REASON: "gen_ai.agent.handoff.reason",
  /** @deprecated Use TOAD_AGENT_LOOP_COUNT instead. Will be removed in v3.0. */
  AGENT_LOOP_COUNT: "gen_ai.agent.loop_count",

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

  // FinOps attribution
  TEAM: "toad_eye.team",
  USER_ID: "toad_eye.user_id",
  FEATURE: "toad_eye.feature",
  ENVIRONMENT: "toad_eye.environment",
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
