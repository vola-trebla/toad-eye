/**
 * Shadow Guardrails integration — records toad-guard validation results
 * as span attributes and metrics without blocking LLM responses.
 *
 * Results are recorded as attributes on the currently active span
 * (typically the LLM call span from traceLLMCall). This avoids
 * trace bloat — no extra child spans per guard rule.
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
import { GEN_AI_ATTRS } from "./types/index.js";
import {
  recordGuardEvaluation,
  recordGuardWouldBlock,
} from "./core/metrics.js";

/**
 * Record a guard validation result as attributes on the active span.
 *
 * Attaches guard attributes directly to the current span (no child span created).
 * Increments guard evaluation counter, and would_block counter if failed.
 */
export function recordGuardResult(result: GuardResult) {
  const activeSpan = trace.getActiveSpan();

  if (activeSpan) {
    activeSpan.setAttributes({
      [GEN_AI_ATTRS.GUARD_MODE]: result.mode,
      [GEN_AI_ATTRS.GUARD_PASSED]: result.passed,
      [GEN_AI_ATTRS.GUARD_RULE_NAME]: result.ruleName,
      ...(!result.passed &&
        result.failureReason !== undefined && {
          [GEN_AI_ATTRS.GUARD_FAILURE_REASON]: result.failureReason,
        }),
    });
  }

  recordGuardEvaluation(result.ruleName);

  if (!result.passed) {
    recordGuardWouldBlock(result.ruleName);
  }
}
