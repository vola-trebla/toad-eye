import { traceLLMCall } from "@toad-eye/instrumentation";
import type { LLMCallOutput } from "@toad-eye/instrumentation";

const MODELS = [
  {
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    costPer1k: 0.003,
  },
  { provider: "gemini", model: "gemini-2.5-flash", costPer1k: 0.001 },
  { provider: "openai", model: "gpt-4o", costPer1k: 0.005 },
] as const;

function randomBetween(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shouldFail() {
  return Math.random() < 0.1;
}

export async function mockLLMCall(prompt: string) {
  const pick = MODELS[randomBetween(0, MODELS.length - 1)]!;

  return traceLLMCall(
    {
      provider: pick.provider,
      model: pick.model,
      prompt,
      temperature: 0.7,
    },
    async (): Promise<LLMCallOutput> => {
      const latency = randomBetween(200, 2000);
      await new Promise((r) => setTimeout(r, latency));

      if (shouldFail()) {
        throw new Error(`${pick.provider} API error: rate limit exceeded`);
      }

      const inputTokens = randomBetween(50, 500);
      const outputTokens = randomBetween(20, 300);
      const cost = ((inputTokens + outputTokens) / 1000) * pick.costPer1k;

      return {
        completion: `Mock response from ${pick.model} for: "${prompt}"`,
        inputTokens,
        outputTokens,
        cost: Math.round(cost * 1000000) / 1000000,
      };
    },
  );
}
