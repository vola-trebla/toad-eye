import { metrics } from "@opentelemetry/api";
import type { Counter, Histogram } from "@opentelemetry/api";
import {
  GEN_AI_ATTRS,
  GEN_AI_METRICS,
  INSTRUMENTATION_NAME,
} from "./types/index.js";

let requestDuration: Histogram;
let requestCost: Histogram;
let tokenUsage: Counter;
let requestsTotal: Counter;
let errorsTotal: Counter;
let agentStepsPerQuery: Histogram;
let agentToolUsage: Counter;

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

  initialized = true;
}

export function recordRequestDuration(
  ms: number,
  provider: string,
  model: string,
) {
  requestDuration.record(ms, {
    [GEN_AI_ATTRS.PROVIDER]: provider,
    [GEN_AI_ATTRS.REQUEST_MODEL]: model,
  });
}

export function recordRequestCost(
  usd: number,
  provider: string,
  model: string,
) {
  requestCost.record(usd, {
    [GEN_AI_ATTRS.PROVIDER]: provider,
    [GEN_AI_ATTRS.REQUEST_MODEL]: model,
  });
}

export function recordTokens(count: number, provider: string, model: string) {
  tokenUsage.add(count, {
    [GEN_AI_ATTRS.PROVIDER]: provider,
    [GEN_AI_ATTRS.REQUEST_MODEL]: model,
  });
}

export function recordRequest(provider: string, model: string) {
  requestsTotal.add(1, {
    [GEN_AI_ATTRS.PROVIDER]: provider,
    [GEN_AI_ATTRS.REQUEST_MODEL]: model,
  });
}

export function recordError(provider: string, model: string) {
  errorsTotal.add(1, {
    [GEN_AI_ATTRS.PROVIDER]: provider,
    [GEN_AI_ATTRS.REQUEST_MODEL]: model,
  });
}

export function recordAgentSteps(stepCount: number) {
  agentStepsPerQuery.record(stepCount);
}

export function recordAgentToolUsage(toolName: string) {
  agentToolUsage.add(1, {
    [GEN_AI_ATTRS.AGENT_TOOL_NAME]: toolName,
  });
}
