/**
 * OpenAI embedding provider using text-embedding-3-small.
 * Calls the OpenAI API directly via fetch — no SDK dependency.
 */

import type { EmbeddingProvider } from "./embedding-provider.js";

const DEFAULT_MODEL = "text-embedding-3-small";
const OPENAI_API_URL = "https://api.openai.com/v1/embeddings";

interface OpenAIEmbeddingResponse {
  readonly data: readonly [{ readonly embedding: readonly number[] }];
}

export function createOpenAIEmbeddingProvider(
  apiKey: string,
  model = DEFAULT_MODEL,
): EmbeddingProvider {
  return {
    name: `openai/${model}`,
    async embed(text: string): Promise<readonly number[]> {
      const response = await fetch(OPENAI_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ input: text, model }),
      });

      if (!response.ok) {
        throw new Error(
          `OpenAI Embeddings API error: ${response.status} ${response.statusText}`,
        );
      }

      const body = (await response.json()) as OpenAIEmbeddingResponse;
      const embedding = body.data?.[0]?.embedding;
      if (!embedding) {
        throw new Error("OpenAI Embeddings API returned no embeddings");
      }
      return embedding;
    },
  };
}
