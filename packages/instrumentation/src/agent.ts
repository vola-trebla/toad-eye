import { trace, SpanStatusCode } from "@opentelemetry/api";
import type { AgentStepInput } from "./types/index.js";
import { GEN_AI_ATTRS, INSTRUMENTATION_NAME } from "./types/index.js";
import { recordAgentSteps, recordAgentToolUsage } from "./core/metrics.js";
import { getConfig } from "./core/tracer.js";

const tracer = trace.getTracer(INSTRUMENTATION_NAME);

/**
 * Record a single agent step as a child span (ReAct pattern: think → act → observe → answer).
 *
 * Creates a short-lived span under the current active context. Call this inside
 * {@link traceAgentQuery} (preferred) or any other active span (e.g. traceLLMCall).
 *
 * - Respects `recordContent` config — content is omitted when recording is disabled.
 * - For `act` steps with a `toolName`, automatically increments the `agent.tool_usage` metric.
 */
function traceAgentStep(input: AgentStepInput) {
  const span = tracer.startSpan(`agent.step.${input.type}`);

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
  });

  if (input.type === "act" && input.toolName !== undefined) {
    recordAgentToolUsage(input.toolName);
  }

  span.setStatus({ code: SpanStatusCode.OK });
  span.end();
}

/**
 * Wrap an entire agent query in a parent span, producing structured ReAct traces.
 *
 * The callback receives a `step` function to record individual steps.
 * When the callback completes, the wrapper automatically records the
 * `agent.steps_per_query` histogram metric with the total step count.
 *
 * Span hierarchy in Jaeger:
 * ```
 * [parent] agent.query "Is anything dangerous near Earth?"
 *   ├── agent.step.think   "I need to check asteroids"
 *   ├── agent.step.act     tool=near-earth-asteroids
 *   ├── agent.step.observe "7 asteroids found"
 *   └── agent.step.answer  "7 asteroids passing safely..."
 * ```
 *
 * @example
 * ```ts
 * const result = await traceAgentQuery("Is anything dangerous near Earth?", async (step) => {
 *   step({ type: "think", stepNumber: 1, content: "I need to check asteroids" });
 *   const data = await callTool("near-earth-asteroids");
 *   step({ type: "act", stepNumber: 2, toolName: "near-earth-asteroids" });
 *   step({ type: "observe", stepNumber: 3, content: `${data.length} asteroids found` });
 *   step({ type: "answer", stepNumber: 4, content: "7 asteroids passing safely..." });
 *   return { answer: "7 asteroids passing safely..." };
 * });
 * ```
 */
export async function traceAgentQuery<T>(
  query: string,
  fn: (step: (input: AgentStepInput) => void) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(`agent.query`, async (span) => {
    const config = getConfig();
    const recordContent = config?.recordContent !== false;

    if (recordContent) {
      span.setAttribute(GEN_AI_ATTRS.AGENT_STEP_CONTENT, query);
    }

    let stepCount = 0;

    try {
      const result = await fn((input) => {
        stepCount++;
        traceAgentStep(input);
      });

      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      span.setStatus({ code: SpanStatusCode.ERROR, message });
      throw error;
    } finally {
      recordAgentSteps(stepCount);
      span.end();
    }
  });
}

export { traceAgentStep };
