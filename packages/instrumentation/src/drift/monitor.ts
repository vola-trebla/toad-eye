/**
 * Drift monitor — runtime semantic drift detection with sampling.
 *
 * Not every response is checked (embedding API calls cost money).
 * By default, every 10th response is sampled. The drift value is
 * recorded as a Prometheus histogram metric with provider/model labels.
 */

import type {
  EmbeddingProvider,
  EmbeddingConfig,
} from "./embedding-provider.js";
import { createOpenAIEmbeddingProvider } from "./openai-embeddings.js";
import { cosineDrift } from "./cosine.js";
import { loadBaseline } from "./baseline.js";
import { recordSemanticDrift } from "../metrics.js";

export interface DriftMonitorConfig {
  readonly embedding: EmbeddingConfig;
  readonly baselinePath: string;
  readonly sampleRate?: number | undefined;
}

export interface DriftMonitor {
  /**
   * Check a response for semantic drift. Respects sampling rate —
   * only every Nth call actually computes embeddings.
   * Returns the drift value if checked, undefined if skipped.
   */
  check(
    response: string,
    provider: string,
    model: string,
  ): Promise<number | undefined>;
}

function createProvider(config: EmbeddingConfig): EmbeddingProvider {
  switch (config.provider) {
    case "openai":
      return createOpenAIEmbeddingProvider(config.apiKey, config.model);
    case "custom":
      return { name: "custom", embed: config.embed };
  }
}

export function createDriftMonitor(config: DriftMonitorConfig): DriftMonitor {
  const provider = createProvider(config.embedding);
  const sampleRate = config.sampleRate ?? 10;
  const baseline = loadBaseline(config.baselinePath);
  let counter = 0;

  if (baseline === undefined) {
    console.warn(
      `[toad-eye] No baseline found at ${config.baselinePath}. Drift monitoring disabled until baseline is saved.`,
    );
  }

  return {
    async check(response, providerName, model) {
      if (baseline === undefined) return undefined;

      counter++;
      if (counter % sampleRate !== 0) return undefined;

      const embedding = await provider.embed(response);
      const drift = cosineDrift(embedding, baseline.embeddings);

      recordSemanticDrift(drift, providerName, model);

      return drift;
    },
  };
}
