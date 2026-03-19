/**
 * Shadow Guardrails integration — records toad-guard validation results
 * as span attributes and metrics without blocking LLM responses.
 *
 * toad-guard validates each LLM response and passes the result here.
 * In shadow mode, validation runs but never throws — results are recorded
 * for observability only, letting you tune guardrail thresholds on
 * production traffic before switching to enforce mode.
 *
 * Usage from toad-guard:
 * ```ts
 * import { recordGuardResult } from "toad-eye";
 *
 * const result = guard.validate(response);
 * recordGuardResult(result); // records as span attrs + metrics
 * ```
 */

import { trace } from "@opentelemetry/api";
import type { GuardResult } from "./types/index.js";
import { GEN_AI_ATTRS, INSTRUMENTATION_NAME } from "./types/index.js";
import {
  recordGuardEvaluation,
  recordGuardWouldBlock,
} from "./core/metrics.js";

const tracer = trace.getTracer(INSTRUMENTATION_NAME);

/**
 * Record a guard validation result as span attributes and metrics.
 *
 * Attaches guard attributes to a child span and increments counters.
 * If the guard failed, also increments the `would_block` counter —
 * useful for measuring how often shadow guardrails would have blocked.
 */
export function recordGuardResult(result: GuardResult) {
  const span = tracer.startSpan(`guard.evaluate.${result.ruleName}`);

  span.setAttributes({
    [GEN_AI_ATTRS.GUARD_MODE]: result.mode,
    [GEN_AI_ATTRS.GUARD_PASSED]: result.passed,
    [GEN_AI_ATTRS.GUARD_RULE_NAME]: result.ruleName,
    ...(!result.passed &&
      result.failureReason !== undefined && {
        [GEN_AI_ATTRS.GUARD_FAILURE_REASON]: result.failureReason,
      }),
  });

  span.end();

  recordGuardEvaluation(result.ruleName);

  if (!result.passed) {
    recordGuardWouldBlock(result.ruleName);
  }
}
