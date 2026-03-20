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
let guardEvaluations: Counter;
let guardWouldBlock: Counter;
let semanticDrift: Histogram;
let budgetExceeded: Counter;
let budgetBlocked: Counter;
let budgetDowngraded: Counter;

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
    description: "Agent tool invocations by tool name",
  });

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

  budgetExceeded = meter.createCounter(GEN_AI_METRICS.BUDGET_EXCEEDED, {
    description: "Number of times a budget limit was exceeded",
  });

  budgetBlocked = meter.createCounter(GEN_AI_METRICS.BUDGET_BLOCKED, {
    description: "Number of LLM calls blocked due to budget limits",
  });

  budgetDowngraded = meter.createCounter(GEN_AI_METRICS.BUDGET_DOWNGRADED, {
    description: "Number of LLM calls downgraded due to budget limits",
  });

  initialized = true;
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
  requestDuration.record(ms, baseLabels(provider, model, attrs));
}

export function recordRequestCost(
  usd: number,
  provider: string,
  model: string,
  attrs?: Record<string, string>,
) {
  requestCost.record(usd, baseLabels(provider, model, attrs));
}

export function recordTokens(
  count: number,
  provider: string,
  model: string,
  attrs?: Record<string, string>,
) {
  tokenUsage.add(count, baseLabels(provider, model, attrs));
}

export function recordRequest(
  provider: string,
  model: string,
  attrs?: Record<string, string>,
) {
  requestsTotal.add(1, baseLabels(provider, model, attrs));
}

export function recordError(
  provider: string,
  model: string,
  attrs?: Record<string, string>,
) {
  errorsTotal.add(1, baseLabels(provider, model, attrs));
}

export function recordAgentSteps(stepCount: number) {
  agentStepsPerQuery.record(stepCount);
}

export function recordAgentToolUsage(toolName: string) {
  agentToolUsage.add(1, {
    [GEN_AI_ATTRS.AGENT_TOOL_NAME]: toolName,
  });
}

export function recordGuardEvaluation(ruleName: string) {
  guardEvaluations.add(1, {
    [GEN_AI_ATTRS.GUARD_RULE_NAME]: ruleName,
  });
}

export function recordGuardWouldBlock(ruleName: string) {
  guardWouldBlock.add(1, {
    [GEN_AI_ATTRS.GUARD_RULE_NAME]: ruleName,
  });
}

export function recordSemanticDrift(
  drift: number,
  provider: string,
  model: string,
) {
  semanticDrift.record(drift, {
    [GEN_AI_ATTRS.PROVIDER]: provider,
    [GEN_AI_ATTRS.REQUEST_MODEL]: model,
  });
}

export function recordBudgetExceeded(budgetType: string) {
  budgetExceeded.add(1, { budget_type: budgetType });
}

export function recordBudgetBlocked(budgetType: string) {
  budgetBlocked.add(1, { budget_type: budgetType });
}

export function recordBudgetDowngraded(budgetType: string) {
  budgetDowngraded.add(1, { budget_type: budgetType });
}
