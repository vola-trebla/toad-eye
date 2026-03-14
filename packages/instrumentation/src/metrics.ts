import { metrics } from "@opentelemetry/api";
import type { Counter, Histogram } from "@opentelemetry/api";
import { LLM_METRICS } from "./types.js";

let requestDuration: Histogram;
let requestCost: Histogram;
let tokensTotal: Counter;
let requestsTotal: Counter;
let errorsTotal: Counter;

let initialized = false;

export function initMetrics() {
  if (initialized) return;

  const meter = metrics.getMeter("toad-eye");

  requestDuration = meter.createHistogram(LLM_METRICS.REQUEST_DURATION, {
    description: "LLM request duration in milliseconds",
    unit: "ms",
  });

  requestCost = meter.createHistogram(LLM_METRICS.REQUEST_COST, {
    description: "LLM request cost in USD",
    unit: "USD",
  });

  tokensTotal = meter.createCounter(LLM_METRICS.TOKENS, {
    description: "Total tokens consumed",
  });

  requestsTotal = meter.createCounter(LLM_METRICS.REQUESTS, {
    description: "Total LLM requests",
  });

  errorsTotal = meter.createCounter(LLM_METRICS.ERRORS, {
    description: "Total failed LLM requests",
  });

  initialized = true;
}

export function recordRequestDuration(
  ms: number,
  provider: string,
  model: string,
) {
  requestDuration.record(ms, { provider, model });
}

export function recordRequestCost(
  usd: number,
  provider: string,
  model: string,
) {
  requestCost.record(usd, { provider, model });
}

export function recordTokens(count: number, provider: string, model: string) {
  tokensTotal.add(count, { provider, model });
}

export function recordRequest(provider: string, model: string) {
  requestsTotal.add(1, { provider, model });
}

export function recordError(provider: string, model: string) {
  errorsTotal.add(1, { provider, model });
}
