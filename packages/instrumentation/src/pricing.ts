/**
 * Built-in pricing table for major LLM models.
 * Prices in USD per 1M tokens (input / output).
 * Updated: March 2026.
 */

export interface ModelPricing {
  readonly inputPer1M: number;
  readonly outputPer1M: number;
}

const BUILT_IN_PRICING: Record<string, ModelPricing> = {
  // OpenAI
  "gpt-4o": { inputPer1M: 2.5, outputPer1M: 10 },
  "gpt-4o-mini": { inputPer1M: 0.15, outputPer1M: 0.6 },
  "gpt-4-turbo": { inputPer1M: 10, outputPer1M: 30 },
  "gpt-4.1": { inputPer1M: 2, outputPer1M: 8 },
  "gpt-4.1-mini": { inputPer1M: 0.4, outputPer1M: 1.6 },
  "gpt-4.1-nano": { inputPer1M: 0.1, outputPer1M: 0.4 },
  o3: { inputPer1M: 10, outputPer1M: 40 },
  "o3-mini": { inputPer1M: 1.1, outputPer1M: 4.4 },
  "o4-mini": { inputPer1M: 1.1, outputPer1M: 4.4 },

  // Anthropic
  "claude-opus-4-20250514": { inputPer1M: 15, outputPer1M: 75 },
  "claude-sonnet-4-20250514": { inputPer1M: 3, outputPer1M: 15 },
  "claude-haiku-3-5-20241022": { inputPer1M: 0.8, outputPer1M: 4 },

  // Google Gemini
  "gemini-2.5-pro": { inputPer1M: 1.25, outputPer1M: 10 },
  "gemini-2.5-flash": { inputPer1M: 0.15, outputPer1M: 0.6 },
  "gemini-2.0-flash": { inputPer1M: 0.1, outputPer1M: 0.4 },
};

let customPricing: Record<string, ModelPricing> = {};

/**
 * Set custom pricing for models (overrides built-in prices).
 * Useful for enterprise contracts or custom/fine-tuned models.
 */
export function setCustomPricing(pricing: Record<string, ModelPricing>) {
  customPricing = { ...pricing };
}

/**
 * Get pricing for a model. Custom pricing takes precedence.
 * Returns undefined if model is not in any pricing table.
 */
export function getModelPricing(model: string): ModelPricing | undefined {
  return customPricing[model] ?? BUILT_IN_PRICING[model];
}

/**
 * Calculate cost for a given model and token counts.
 * Returns 0 if model pricing is not found.
 */
export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const pricing = getModelPricing(model);
  if (!pricing) return 0;

  const cost =
    (inputTokens / 1_000_000) * pricing.inputPer1M +
    (outputTokens / 1_000_000) * pricing.outputPer1M;

  return Math.round(cost * 1_000_000) / 1_000_000;
}
