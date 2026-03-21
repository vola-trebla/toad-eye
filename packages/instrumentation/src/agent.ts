import { trace, SpanStatusCode } from "@opentelemetry/api";
import type {
  AgentStepInput,
  AgentQueryOptions,
  AgentQueryInput,
} from "./types/index.js";
import { GEN_AI_ATTRS, INSTRUMENTATION_NAME } from "./types/index.js";
import { recordAgentSteps, recordAgentToolUsage } from "./core/metrics.js";
import { getConfig } from "./core/tracer.js";

const tracer = trace.getTracer(INSTRUMENTATION_NAME);

const DEFAULT_MAX_STEPS = 25;

/**
 * Record a single agent step as a child span (ReAct pattern).
 * Supports: think, act, observe, answer, handoff.
 */
function traceAgentStep(input: AgentStepInput) {
  const spanName =
    input.type === "act" && input.toolName !== undefined
      ? `execute_tool ${input.toolName}`
      : `gen_ai.agent.step.${input.type}`;
  const span = tracer.startSpan(spanName);

  const config = getConfig();
  const recordContent = config?.recordContent !== false;

  span.setAttributes({
    // Emit new toad_eye namespace (canonical)
    [GEN_AI_ATTRS.TOAD_AGENT_STEP_TYPE]: input.type,
    [GEN_AI_ATTRS.TOAD_AGENT_STEP_NUMBER]: input.stepNumber,
    // Emit deprecated aliases for backward compat (removed in v3.0)
    [GEN_AI_ATTRS.AGENT_STEP_TYPE]: input.type,
    [GEN_AI_ATTRS.AGENT_STEP_NUMBER]: input.stepNumber,
    ...(input.toolName !== undefined && {
      // OTel spec attribute (gen_ai.tool.name)
      [GEN_AI_ATTRS.TOOL_NAME]: input.toolName,
      // Deprecated alias (gen_ai.agent.tool.name) — removed in v3.0
      [GEN_AI_ATTRS.AGENT_TOOL_NAME]: input.toolName,
    }),
    ...(input.toolType !== undefined && {
      [GEN_AI_ATTRS.TOOL_TYPE]: input.toolType,
    }),
    ...(recordContent &&
      input.content !== undefined && {
        [GEN_AI_ATTRS.TOAD_AGENT_STEP_CONTENT]: input.content,
        // Deprecated alias — removed in v3.0
        [GEN_AI_ATTRS.AGENT_STEP_CONTENT]: input.content,
      }),
    // Handoff attributes — new toad_eye namespace
    ...(input.toAgent !== undefined && {
      [GEN_AI_ATTRS.TOAD_AGENT_HANDOFF_TO]: input.toAgent,
      // Deprecated alias — removed in v3.0
      [GEN_AI_ATTRS.AGENT_HANDOFF_TO]: input.toAgent,
    }),
    ...(input.handoffReason !== undefined && {
      [GEN_AI_ATTRS.TOAD_AGENT_HANDOFF_REASON]: input.handoffReason,
      // Deprecated alias — removed in v3.0
      [GEN_AI_ATTRS.AGENT_HANDOFF_REASON]: input.handoffReason,
    }),
  });

  if (input.type === "act" && input.toolName !== undefined) {
    recordAgentToolUsage(input.toolName);
  }

  span.setStatus({ code: SpanStatusCode.OK });
  span.end();
}

/**
 * Wrap an entire agent query in a parent span with ReAct tracing.
 *
 * Accepts either a string query (backward-compatible) or an object with
 * agent metadata per OTel GenAI spec (agentName, agentId).
 *
 * Supports multi-agent via nesting — child traceAgentQuery calls
 * automatically become child spans in Jaeger.
 *
 * Loop detection: counts observe→think transitions. Records loop count
 * as span attribute. Emits warning when maxSteps exceeded.
 *
 * @example
 * ```ts
 * // Simple form (backward-compatible)
 * await traceAgentQuery('Is anything dangerous?', async (step) => { ... });
 *
 * // Object form with agent metadata (OTel GenAI spec)
 * await traceAgentQuery(
 *   { query: 'Is anything dangerous?', agentName: 'space-monitor', agentId: 'agent-001' },
 *   async (step) => { ... }
 * );
 *
 * // Multi-agent: orchestrator delegates to specialist
 * await traceAgentQuery({ query: 'Analyze data', agentName: 'orchestrator' }, async (step) => {
 *   step({ type: 'think', stepNumber: 1, content: 'Need domain expert' });
 *   step({ type: 'handoff', stepNumber: 2, toAgent: 'specialist', handoffReason: 'domain expertise' });
 *
 *   const result = await traceAgentQuery({ query: 'Analyze', agentName: 'specialist' }, async (step) => {
 *     step({ type: 'act', stepNumber: 1, toolName: 'analyze', toolType: 'function' });
 *     step({ type: 'answer', stepNumber: 2, content: 'analysis complete' });
 *     return { answer: 'done' };
 *   });
 * });
 * ```
 */
export async function traceAgentQuery<T>(
  queryOrInput: string | AgentQueryInput,
  fn: (step: (input: AgentStepInput) => void) => Promise<T>,
  options?: AgentQueryOptions,
): Promise<T> {
  const resolved =
    typeof queryOrInput === "string"
      ? { query: queryOrInput, agentName: undefined, agentId: undefined }
      : queryOrInput;

  const spanName = resolved.agentName
    ? `invoke_agent ${resolved.agentName}`
    : `invoke_agent`;

  return tracer.startActiveSpan(spanName, async (span) => {
    const config = getConfig();
    const recordContent = config?.recordContent !== false;
    const maxSteps = options?.maxSteps ?? DEFAULT_MAX_STEPS;

    // OTel GenAI agent attributes
    if (resolved.agentName !== undefined) {
      span.setAttribute(GEN_AI_ATTRS.AGENT_NAME, resolved.agentName);
    }
    if (resolved.agentId !== undefined) {
      span.setAttribute(GEN_AI_ATTRS.AGENT_ID, resolved.agentId);
    }
    if (recordContent) {
      span.setAttribute(GEN_AI_ATTRS.TOAD_AGENT_STEP_CONTENT, resolved.query);
      // Deprecated alias — removed in v3.0
      span.setAttribute(GEN_AI_ATTRS.AGENT_STEP_CONTENT, resolved.query);
    }

    let stepCount = 0;
    let loopCount = 0;
    let lastStepType: string | undefined;
    let maxStepsWarned = false;

    try {
      const result = await fn((input) => {
        stepCount++;

        // Loop detection: observe → think = one loop iteration
        if (input.type === "think" && lastStepType === "observe") {
          loopCount++;
        }
        lastStepType = input.type;

        // Max steps guard
        if (stepCount > maxSteps && !maxStepsWarned) {
          maxStepsWarned = true;
          console.warn(
            `toad-eye: agent exceeded maxSteps (${maxSteps}). Current: ${stepCount}`,
          );
          span.addEvent("agent.max_steps_exceeded", {
            "agent.max_steps": maxSteps,
            "agent.current_steps": stepCount,
          });
        }

        traceAgentStep(input);
      });

      span.setAttribute(GEN_AI_ATTRS.TOAD_AGENT_LOOP_COUNT, loopCount);
      span.setAttribute(GEN_AI_ATTRS.AGENT_LOOP_COUNT, loopCount);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      span.setAttribute(GEN_AI_ATTRS.TOAD_AGENT_LOOP_COUNT, loopCount);
      span.setAttribute(GEN_AI_ATTRS.AGENT_LOOP_COUNT, loopCount);
      span.setStatus({ code: SpanStatusCode.ERROR, message });
      throw error;
    } finally {
      recordAgentSteps(stepCount);
      span.end();
    }
  });
}

export { traceAgentStep };
