import type { LLMProvider } from "./providers.js";

/** Span status values used in trace attributes. */
export type SpanStatus = "success" | "error";

/** ReAct agent step types: think → act → observe → answer */
export type AgentStepType = "think" | "act" | "observe" | "answer";

/** Input for traceAgentStep — describes a single agent step */
export interface AgentStepInput {
  readonly type: AgentStepType;
  readonly stepNumber: number;
  readonly content?: string | undefined;
  readonly toolName?: string | undefined;
}

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
