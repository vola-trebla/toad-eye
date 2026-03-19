/**
 * Cosine similarity and drift calculation for embedding vectors.
 *
 * drift = 1 - cosine_similarity(current, baseline)
 * - drift = 0 → identical to baseline
 * - drift > 0.3 → significant deviation (default alert threshold)
 */

export function cosineSimilarity(
  a: readonly number[],
  b: readonly number[],
): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dot / denominator;
}

/**
 * Calculate drift as distance from the nearest baseline embedding.
 * Returns the minimum drift value (closest match).
 */
export function cosineDrift(
  current: readonly number[],
  baselines: readonly (readonly number[])[],
): number {
  if (baselines.length === 0) return 1;

  let maxSimilarity = -1;
  for (const baseline of baselines) {
    const similarity = cosineSimilarity(current, baseline);
    if (similarity > maxSimilarity) {
      maxSimilarity = similarity;
    }
  }

  return 1 - maxSimilarity;
}
