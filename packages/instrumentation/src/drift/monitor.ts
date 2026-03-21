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
import { recordSemanticDrift } from "../core/metrics.js";

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

  /**
   * Fire-and-forget drift check — does NOT block the caller.
   * Errors are logged to console.warn, never thrown.
   * Use this in hot paths (e.g. inside traceLLMCall) to avoid
   * blocking the LLM response delivery.
   */
  checkInBackground(response: string, provider: string, model: string): void;
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

  async function performCheck(
    response: string,
    providerName: string,
    model: string,
  ): Promise<number | undefined> {
    if (baseline === undefined) return undefined;

    counter++;
    if (counter % sampleRate !== 0) return undefined;

    const embedding = await provider.embed(response);
    const drift = cosineDrift(embedding, baseline.embeddings);

    recordSemanticDrift(drift, providerName, model);

    return drift;
  }

  return {
    check: performCheck,

    checkInBackground(response, providerName, model) {
      let timer: ReturnType<typeof setTimeout>;
      const timeout = new Promise<never>(
        (_, reject) =>
          (timer = setTimeout(
            () => reject(new Error("Drift check timeout (5s)")),
            5000,
          )),
      );
      void Promise.race([performCheck(response, providerName, model), timeout])
        .catch((err) => {
          console.warn(
            `[toad-eye] Drift check failed (non-blocking): ${err instanceof Error ? err.message : String(err)}`,
          );
        })
        .finally(() => clearTimeout(timer));
    },
  };
}
