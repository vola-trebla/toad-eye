/**
 * Semantic Drift Monitoring — detect silent LLM quality degradation
 * by comparing current responses to a saved baseline via embeddings.
 */

export type {
  EmbeddingProvider,
  EmbeddingConfig,
  OpenAIEmbeddingConfig,
  CustomEmbeddingConfig,
} from "./embedding-provider.js";
export { createOpenAIEmbeddingProvider } from "./openai-embeddings.js";
export { cosineSimilarity, cosineDrift } from "./cosine.js";
export { saveBaseline, loadBaseline, type DriftBaseline } from "./baseline.js";
export {
  createDriftMonitor,
  type DriftMonitor,
  type DriftMonitorConfig,
} from "./monitor.js";
