import { metrics } from "@opentelemetry/api";
import type { Counter, Histogram } from "@opentelemetry/api";
import { GEN_AI_METRICS, INSTRUMENTATION_NAME } from "./types.js";

let requestDuration: Histogram;
let requestCost: Histogram;
let tokenUsage: Counter;
let requestsTotal: Counter;
let errorsTotal: Counter;

let initialized = false;

const LABEL_PROVIDER = "gen_ai.provider.name";
const LABEL_MODEL = "gen_ai.request.model";

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

  initialized = true;
}

export function recordRequestDuration(
  ms: number,
  provider: string,
  model: string,
) {
  requestDuration.record(ms, {
    [LABEL_PROVIDER]: provider,
    [LABEL_MODEL]: model,
  });
}

export function recordRequestCost(
  usd: number,
  provider: string,
  model: string,
) {
  requestCost.record(usd, {
    [LABEL_PROVIDER]: provider,
    [LABEL_MODEL]: model,
  });
}

export function recordTokens(count: number, provider: string, model: string) {
  tokenUsage.add(count, {
    [LABEL_PROVIDER]: provider,
    [LABEL_MODEL]: model,
  });
}

export function recordRequest(provider: string, model: string) {
  requestsTotal.add(1, {
    [LABEL_PROVIDER]: provider,
    [LABEL_MODEL]: model,
  });
}

export function recordError(provider: string, model: string) {
  errorsTotal.add(1, {
    [LABEL_PROVIDER]: provider,
    [LABEL_MODEL]: model,
  });
}
