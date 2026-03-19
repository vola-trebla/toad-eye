/**
 * Embedding provider abstraction for semantic drift monitoring.
 *
 * Implementations convert text into float vectors for cosine similarity comparison.
 * Default: OpenAI text-embedding-3-small (cheap, fast).
 * Users can provide a custom implementation via the EmbeddingProvider interface.
 */

export interface EmbeddingProvider {
  readonly name: string;
  embed(text: string): Promise<readonly number[]>;
}

export interface OpenAIEmbeddingConfig {
  readonly provider: "openai";
  readonly apiKey: string;
  readonly model?: string | undefined;
}

export interface CustomEmbeddingConfig {
  readonly provider: "custom";
  readonly embed: (text: string) => Promise<readonly number[]>;
}

export type EmbeddingConfig = OpenAIEmbeddingConfig | CustomEmbeddingConfig;
