import { metrics } from "@opentelemetry/api";
import type { Counter, Histogram } from "@opentelemetry/api";
import {
  GEN_AI_ATTRS,
  GEN_AI_METRICS,
  INSTRUMENTATION_NAME,
} from "../types/index.js";

let requestDuration: Histogram;
let requestCost: Histogram;
let tokenUsage: Counter;
let requestsTotal: Counter;
let errorsTotal: Counter;
let agentStepsPerQuery: Histogram;
let agentToolUsage: Counter;
let agentToolDuration: Histogram;
let guardEvaluations: Counter;
let guardWouldBlock: Counter;
let semanticDrift: Histogram;
let timeToFirstToken: Histogram;
let budgetExceeded: Counter;
let budgetBlocked: Counter;
let budgetDowngraded: Counter;
let responseEmpty: Counter;
let responseLatencyPerToken: Histogram;
let contextUtilization: Histogram;
let contextBlocked: Counter;

let initialized = false;

export function initMetrics() {
  if (initialized) return;

  const meter = metrics.getMeter(INSTRUMENTATION_NAME);

  requestDuration = meter.createHistogram(GEN_AI_METRICS.REQUEST_DURATION, {
    description: "GenAI operation duration in milliseconds",
    unit: "ms",
  });

  requestCost = meter.createHistogram(GEN_AI_METRICS.REQUEST_COST, {
    description: "GenAI request cost in USD",
    unit: "USD",
  });

  tokenUsage = meter.createCounter(GEN_AI_METRICS.TOKEN_USAGE, {
    description: "Total tokens consumed",
  });

  requestsTotal = meter.createCounter(GEN_AI_METRICS.REQUESTS, {
    description: "Total GenAI requests",
  });

  errorsTotal = meter.createCounter(GEN_AI_METRICS.ERRORS, {
    description: "Total failed GenAI requests",
  });

  agentStepsPerQuery = meter.createHistogram(
    GEN_AI_METRICS.AGENT_STEPS_PER_QUERY,
    {
      description: "Number of agent steps per query",
    },
  );

  agentToolUsage = meter.createCounter(GEN_AI_METRICS.AGENT_TOOL_USAGE, {
    description: "Agent tool invocations by tool name and status",
  });

  agentToolDuration = meter.createHistogram(
    GEN_AI_METRICS.AGENT_TOOL_DURATION,
    {
      description: "Agent tool execution duration in milliseconds",
      unit: "ms",
    },
  );

  guardEvaluations = meter.createCounter(GEN_AI_METRICS.GUARD_EVALUATIONS, {
    description: "Total guard evaluations (shadow + enforce)",
  });

  guardWouldBlock = meter.createCounter(GEN_AI_METRICS.GUARD_WOULD_BLOCK, {
    description: "Guard evaluations that would have blocked the response",
  });

  semanticDrift = meter.createHistogram(GEN_AI_METRICS.SEMANTIC_DRIFT, {
    description:
      "Semantic drift from baseline (0 = identical, 1 = completely different)",
  });

  timeToFirstToken = meter.createHistogram(GEN_AI_METRICS.TIME_TO_FIRST_TOKEN, {
    description: "Time from request start to first streaming token (ms)",
    unit: "ms",
  });

  budgetExceeded = meter.createCounter(GEN_AI_METRICS.BUDGET_EXCEEDED, {
    description: "Number of times a budget limit was exceeded",
  });

  budgetBlocked = meter.createCounter(GEN_AI_METRICS.BUDGET_BLOCKED, {
    description: "Number of LLM calls blocked due to budget limits",
  });

  budgetDowngraded = meter.createCounter(GEN_AI_METRICS.BUDGET_DOWNGRADED, {
    description: "Number of LLM calls downgraded due to budget limits",
  });

  responseEmpty = meter.createCounter(GEN_AI_METRICS.RESPONSE_EMPTY, {
    description:
      "Number of LLM responses with empty or whitespace-only completion",
  });

  responseLatencyPerToken = meter.createHistogram(
    GEN_AI_METRICS.RESPONSE_LATENCY_PER_TOKEN,
    {
      description:
        "Generation latency normalized per output token (ms/token). Higher values indicate slower generation speed.",
      unit: "ms",
    },
  );

  contextUtilization = meter.createHistogram(
    GEN_AI_METRICS.CONTEXT_UTILIZATION,
    {
      description:
        "Ratio of input tokens to model context window (0.0–1.0+). Values above 0.8 indicate risk of context overflow.",
    },
  );

  contextBlocked = meter.createCounter(GEN_AI_METRICS.CONTEXT_BLOCKED, {
    description: "Number of LLM calls blocked by context guard",
  });

  initialized = true;
}

/** Reset metrics state so the next initMetrics() creates fresh instruments. Called from shutdown(). */
export function resetMetrics() {
  initialized = false;
}

/** Returns true if metrics are safe to record. Prevents crash if called before initMetrics(). */
function isReady(): boolean {
  return initialized;
}

/** Build metric labels: provider + model + optional FinOps attributes. */
function baseLabels(
  provider: string,
  model: string,
  attrs?: Record<string, string>,
): Record<string, string> {
  return {
    [GEN_AI_ATTRS.PROVIDER]: provider,
    [GEN_AI_ATTRS.REQUEST_MODEL]: model,
    ...attrs,
  };
}

export function recordRequestDuration(
  ms: number,
  provider: string,
  model: string,
  attrs?: Record<string, string>,
) {
  if (!isReady()) return;
  requestDuration.record(ms, baseLabels(provider, model, attrs));
}

export function recordRequestCost(
  usd: number,
  provider: string,
  model: string,
  attrs?: Record<string, string>,
) {
  if (!isReady()) return;
  requestCost.record(usd, baseLabels(provider, model, attrs));
}

export function recordTokens(
  count: number,
  provider: string,
  model: string,
  attrs?: Record<string, string>,
) {
  if (!isReady()) return;
  tokenUsage.add(count, baseLabels(provider, model, attrs));
}

export function recordRequest(
  provider: string,
  model: string,
  attrs?: Record<string, string>,
) {
  if (!isReady()) return;
  requestsTotal.add(1, baseLabels(provider, model, attrs));
}

export function recordError(
  provider: string,
  model: string,
  attrs?: Record<string, string>,
) {
  if (!isReady()) return;
  errorsTotal.add(1, baseLabels(provider, model, attrs));
}

export function recordAgentSteps(stepCount: number) {
  if (!isReady()) return;
  agentStepsPerQuery.record(stepCount);
}

export function recordAgentToolUsage(
  toolName: string,
  status: "success" | "error" = "success",
) {
  if (!isReady()) return;
  agentToolUsage.add(1, {
    [GEN_AI_ATTRS.TOOL_NAME]: toolName,
    "tool.status": status,
  });
}

export function recordAgentToolDuration(toolName: string, durationMs: number) {
  if (!isReady()) return;
  agentToolDuration.record(durationMs, {
    [GEN_AI_ATTRS.TOOL_NAME]: toolName,
  });
}

export function recordGuardEvaluation(ruleName: string) {
  if (!isReady()) return;
  guardEvaluations.add(1, {
    [GEN_AI_ATTRS.GUARD_RULE_NAME]: ruleName,
  });
}

export function recordGuardWouldBlock(ruleName: string) {
  if (!isReady()) return;
  guardWouldBlock.add(1, {
    [GEN_AI_ATTRS.GUARD_RULE_NAME]: ruleName,
  });
}

export function recordSemanticDrift(
  drift: number,
  provider: string,
  model: string,
) {
  if (!isReady()) return;
  semanticDrift.record(drift, {
    [GEN_AI_ATTRS.PROVIDER]: provider,
    [GEN_AI_ATTRS.REQUEST_MODEL]: model,
  });
}

export function recordTimeToFirstToken(
  ms: number,
  provider: string,
  model: string,
) {
  if (!isReady()) return;
  timeToFirstToken.record(ms, {
    [GEN_AI_ATTRS.PROVIDER]: provider,
    [GEN_AI_ATTRS.REQUEST_MODEL]: model,
  });
}

export function recordBudgetExceeded(budgetType: string) {
  if (!isReady()) return;
  budgetExceeded.add(1, { budget_type: budgetType });
}

export function recordBudgetBlocked(budgetType: string) {
  if (!isReady()) return;
  budgetBlocked.add(1, { budget_type: budgetType });
}

export function recordBudgetDowngraded(budgetType: string) {
  if (!isReady()) return;
  budgetDowngraded.add(1, { budget_type: budgetType });
}

export function recordResponseEmpty(
  provider: string,
  model: string,
  attrs?: Record<string, string>,
) {
  if (!isReady()) return;
  responseEmpty.add(1, baseLabels(provider, model, attrs));
}

export function recordResponseLatencyPerToken(
  msPerToken: number,
  provider: string,
  model: string,
  attrs?: Record<string, string>,
) {
  if (!isReady()) return;
  responseLatencyPerToken.record(
    msPerToken,
    baseLabels(provider, model, attrs),
  );
}

export function recordContextUtilization(
  utilization: number,
  provider: string,
  model: string,
) {
  if (!isReady()) return;
  contextUtilization.record(utilization, {
    [GEN_AI_ATTRS.PROVIDER]: provider,
    [GEN_AI_ATTRS.REQUEST_MODEL]: model,
  });
}

export function recordContextBlocked(model: string) {
  if (!isReady()) return;
  contextBlocked.add(1, {
    [GEN_AI_ATTRS.REQUEST_MODEL]: model,
  });
}
