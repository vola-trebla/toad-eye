/**
 * Shared LLM call orchestration — budget, metrics, context guard.
 *
 * Both traceLLMCall() (manual) and createStreamingHandler() (auto)
 * need the same pre/post-call logic. This module provides it as
 * composable functions to eliminate duplication.
 *
 * @internal Not exported from the public API.
 */

import type { Span } from "@opentelemetry/api";
import type { LLMProvider } from "../types/index.js";
import { GEN_AI_ATTRS } from "../types/index.js";
import { calculateCost, getModelPricing } from "./pricing.js";
import {
  recordRequest,
  recordRequestDuration,
  recordRequestCost,
  recordTokens,
  recordResponseEmpty,
  recordResponseLatencyPerToken,
  recordContextUtilization,
  recordContextBlocked,
  recordBudgetExceeded,
  recordBudgetDowngraded,
  recordBudgetBlocked,
  recordError,
} from "./metrics.js";
import { getConfig, getBudgetTracker } from "./tracer.js";
import { ToadBudgetExceededError } from "../budget/index.js";
import type { BudgetTracker } from "../budget/index.js";

// ── Budget pre-check ──────────────────────────────────────────────

export interface BudgetPreCheckResult {
  readonly effectiveProvider: LLMProvider;
  readonly effectiveModel: string;
  readonly estimatedCost: number;
  readonly budget: BudgetTracker | null;
}

/**
 * Run budget check before the LLM call.
 * May downgrade provider/model if budget is in downgrade mode.
 * Throws ToadBudgetExceededError if budget is in block mode.
 */
export function performBudgetPreCheck(
  provider: LLMProvider,
  model: string,
  userId: string | undefined,
): BudgetPreCheckResult {
  const budget = getBudgetTracker();
  const estimatedCost = budget ? calculateCost(model, 500, 200) : 0;

  let effectiveProvider = provider;
  let effectiveModel = model;

  if (budget) {
    const override = budget.checkBefore(provider, model, userId, estimatedCost);
    if (override) {
      effectiveProvider = override.provider as LLMProvider;
      effectiveModel = override.model;
      recordBudgetDowngraded(override.budget);
    }
  }

  return { effectiveProvider, effectiveModel, estimatedCost, budget };
}

// ── Success metrics ───────────────────────────────────────────────

export interface SuccessMetricsInput {
  readonly duration: number;
  readonly provider: string;
  readonly model: string;
  readonly cost: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly completion: string;
  readonly attrs?: Readonly<Record<string, string>>;
}

/**
 * Record all success-path metrics: request, duration, cost, tokens,
 * empty response detection, latency per token.
 */
export function recordSuccessMetrics(input: SuccessMetricsInput) {
  const {
    duration,
    provider,
    model,
    cost,
    inputTokens,
    outputTokens,
    completion,
    attrs,
  } = input;

  recordRequest(provider, model, attrs);
  recordRequestDuration(duration, provider, model, attrs);
  recordRequestCost(cost, provider, model, attrs);
  recordTokens(inputTokens + outputTokens, provider, model, attrs);

  if (completion.trim() === "") {
    recordResponseEmpty(provider, model, attrs);
  }
  if (outputTokens > 0) {
    recordResponseLatencyPerToken(
      duration / outputTokens,
      provider,
      model,
      attrs,
    );
  }
}

// ── Context guard ─────────────────────────────────────────────────

/**
 * Evaluate context window utilization and trigger warnings/blocks.
 * Must be called BEFORE span.end().
 */
export function evaluateContextGuard(
  span: Span,
  model: string,
  provider: string,
  inputTokens: number,
) {
  const pricing = getModelPricing(model);
  if (!pricing?.maxContextTokens || inputTokens <= 0) return;

  const utilization = inputTokens / pricing.maxContextTokens;
  span.setAttribute(GEN_AI_ATTRS.CONTEXT_UTILIZATION, utilization);
  recordContextUtilization(utilization, provider, model);

  const guard = getConfig()?.contextGuard;
  if (!guard) return;

  if (guard.alertAt !== undefined && utilization >= guard.alertAt) {
    recordContextBlocked(model);
    span.addEvent("gen_ai.context.limit_exceeded", {
      "gen_ai.toad_eye.context_utilization": utilization,
      "gen_ai.toad_eye.context.threshold": guard.alertAt,
    });
    console.warn(
      `toad-eye: context window ${(utilization * 100).toFixed(0)}% full for ${model} — exceeds alertAt threshold ${(guard.alertAt * 100).toFixed(0)}%. Compress context before next call.`,
    );
  } else if (guard.warnAt !== undefined && utilization >= guard.warnAt) {
    console.warn(
      `toad-eye: context window ${(utilization * 100).toFixed(0)}% full for ${model} (${inputTokens}/${pricing.maxContextTokens} tokens)`,
    );
  }
}

// ── Budget post-check ─────────────────────────────────────────────

/**
 * Record actual cost after the LLM call. Releases the reservation
 * made in performBudgetPreCheck. Warns if budget exceeded.
 */
export function recordBudgetPostCheck(
  budget: BudgetTracker | null,
  cost: number,
  model: string,
  userId: string | undefined,
  estimatedCost: number,
) {
  if (!budget) return;

  const exceeded = budget.recordCost(cost, model, userId, estimatedCost);
  if (exceeded) {
    recordBudgetExceeded(exceeded.budget);
    console.warn(
      `toad-eye: ${exceeded.budget} budget exceeded — limit $${exceeded.limit}, current $${exceeded.current.toFixed(2)}`,
    );
  }
}

// ── Error metrics ─────────────────────────────────────────────────

/**
 * Record error-path metrics. Distinguishes budget block errors from
 * generic errors to avoid inflating error rate.
 */
export function handleErrorMetrics(
  error: unknown,
  duration: number,
  provider: string,
  model: string,
  budget: BudgetTracker | null,
  estimatedCost: number,
  attrs?: Readonly<Record<string, string>>,
) {
  recordRequest(provider, model, attrs);
  recordRequestDuration(duration, provider, model, attrs);

  if (budget) {
    budget.releaseReservation(estimatedCost);
  }

  if (error instanceof ToadBudgetExceededError) {
    recordBudgetBlocked(error.budget);
  } else {
    recordError(provider, model, attrs);
  }
}
