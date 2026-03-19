/**
 * Baseline storage — save and load embedding baselines as JSON files.
 *
 * Baseline files contain embeddings of "known good" responses.
 * Drift monitoring compares current responses against these baselines.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";

export interface DriftBaseline {
  readonly model: string;
  readonly provider: string;
  readonly embeddingModel: string;
  readonly embeddings: readonly (readonly number[])[];
  readonly sampleCount: number;
  readonly createdAt: string;
}

export function saveBaseline(filepath: string, baseline: DriftBaseline) {
  writeFileSync(filepath, JSON.stringify(baseline, null, 2), "utf-8");
}

export function loadBaseline(filepath: string): DriftBaseline | undefined {
  if (!existsSync(filepath)) return undefined;
  const raw = readFileSync(filepath, "utf-8");
  return JSON.parse(raw) as DriftBaseline;
}
