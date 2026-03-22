import { getModelPricing } from "../core/pricing.js";
import { getConfig } from "../core/tracer.js";
import { ToadContextExceededError } from "./error.js";

let warnedModels = new Set<string>();

export function resetContextGuardState() {
  warnedModels = new Set();
}

/**
 * Check context utilization before an LLM call.
 * - If utilization > blockAt → throw ToadContextExceededError
 * - If utilization > warnAt → console.warn (once per model per session)
 * - If model unknown or no guard configured → skip silently
 */
export function checkContextGuard(model: string, inputTokens: number) {
  if (inputTokens <= 0) return;

  const config = getConfig();
  const guard = config?.contextGuard;
  if (!guard) return;

  const pricing = getModelPricing(model);
  if (!pricing?.maxContextTokens) return;

  const utilization = inputTokens / pricing.maxContextTokens;

  if (guard.blockAt !== undefined && utilization >= guard.blockAt) {
    throw new ToadContextExceededError({
      utilization,
      threshold: guard.blockAt,
      model,
      maxContextTokens: pricing.maxContextTokens,
      inputTokens,
    });
  }

  if (guard.warnAt !== undefined && utilization >= guard.warnAt) {
    const key = `${model}:${Math.floor(utilization * 10)}`;
    if (!warnedModels.has(key)) {
      warnedModels.add(key);
      console.warn(
        `toad-eye: context window ${(utilization * 100).toFixed(0)}% full for ${model} (${inputTokens}/${pricing.maxContextTokens} tokens)`,
      );
    }
  }
}
