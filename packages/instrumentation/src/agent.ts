import { trace, SpanStatusCode } from "@opentelemetry/api";
import type { AgentStepInput, AgentQueryOptions } from "./types/index.js";
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
    [GEN_AI_ATTRS.AGENT_STEP_TYPE]: input.type,
    [GEN_AI_ATTRS.AGENT_STEP_NUMBER]: input.stepNumber,
    ...(input.toolName !== undefined && {
      [GEN_AI_ATTRS.AGENT_TOOL_NAME]: input.toolName,
    }),
    ...(recordContent &&
      input.content !== undefined && {
        [GEN_AI_ATTRS.AGENT_STEP_CONTENT]: input.content,
      }),
    // Handoff attributes
    ...(input.toAgent !== undefined && {
      [GEN_AI_ATTRS.AGENT_HANDOFF_TO]: input.toAgent,
    }),
    ...(input.handoffReason !== undefined && {
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
 * Supports multi-agent via nesting — child traceAgentQuery calls
 * automatically become child spans in Jaeger.
 *
 * Loop detection: counts observe→think transitions. Records loop count
 * as span attribute. Emits warning when maxSteps exceeded.
 *
 * @example
 * ```ts
 * // Multi-agent: orchestrator delegates to specialist
 * await traceAgentQuery('orchestrator', async (step) => {
 *   step({ type: 'think', stepNumber: 1, content: 'Need domain expert' });
 *   step({ type: 'handoff', stepNumber: 2, toAgent: 'specialist', handoffReason: 'domain expertise' });
 *
 *   const result = await traceAgentQuery('specialist', async (step) => {
 *     step({ type: 'act', stepNumber: 1, toolName: 'analyze' });
 *     step({ type: 'answer', stepNumber: 2, content: 'analysis complete' });
 *     return { answer: 'done' };
 *   });
 * });
 * ```
 */
export async function traceAgentQuery<T>(
  query: string,
  fn: (step: (input: AgentStepInput) => void) => Promise<T>,
  options?: AgentQueryOptions,
): Promise<T> {
  return tracer.startActiveSpan(`invoke_agent`, async (span) => {
    const config = getConfig();
    const recordContent = config?.recordContent !== false;
    const maxSteps = options?.maxSteps ?? DEFAULT_MAX_STEPS;

    if (recordContent) {
      span.setAttribute(GEN_AI_ATTRS.AGENT_STEP_CONTENT, query);
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

      span.setAttribute(GEN_AI_ATTRS.AGENT_LOOP_COUNT, loopCount);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
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
