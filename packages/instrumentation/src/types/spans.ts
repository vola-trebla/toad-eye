import type { LLMProvider } from "./providers.js";

/** Span status values used in trace attributes. */
export type SpanStatus = "success" | "error";

/** ReAct agent step types: think → act → observe → answer → handoff */
export type AgentStepType = "think" | "act" | "observe" | "answer" | "handoff";

/** Input for traceAgentStep — describes a single agent step */
export interface AgentStepInput {
  readonly type: AgentStepType;
  readonly stepNumber: number;
  readonly content?: string | undefined;
  readonly toolName?: string | undefined;
  /** Tool type per OTel GenAI spec: function, extension, retrieval, builtin */
  readonly toolType?:
    | "function"
    | "extension"
    | "retrieval"
    | "builtin"
    | undefined;
  /** Duration of tool execution in milliseconds (for act steps). */
  readonly toolDurationMs?: number | undefined;
  /** Whether the tool execution succeeded or failed (for act steps). */
  readonly toolStatus?: "success" | "error" | undefined;
  /** Target agent name for handoff steps */
  readonly toAgent?: string | undefined;
  /** Reason for handoff */
  readonly handoffReason?: string | undefined;
}

/** Options for traceAgentQuery */
export interface AgentQueryOptions {
  /** Max steps before recording a warning. Default: 25 */
  readonly maxSteps?: number | undefined;
}

/** Input for traceAgentQuery — object form with agent metadata */
export interface AgentQueryInput {
  readonly query: string;
  /** Agent name — maps to gen_ai.agent.name and span name invoke_agent {agentName} */
  readonly agentName?: string | undefined;
  /** Agent identifier — maps to gen_ai.agent.id */
  readonly agentId?: string | undefined;
}

/** Guard execution mode */
export type GuardMode = "shadow" | "enforce";

/**
 * Result of a toad-guard validation — the contract between toad-guard and toad-eye.
 * toad-guard produces this, toad-eye consumes it via recordGuardResult().
 */
export interface GuardResult {
  readonly mode: GuardMode;
  readonly passed: boolean;
  readonly ruleName: string;
  readonly failureReason?: string | undefined;
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
