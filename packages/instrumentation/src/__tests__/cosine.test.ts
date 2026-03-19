import { describe, it, expect } from "vitest";
import { cosineSimilarity, cosineDrift } from "../drift/cosine.js";

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it("returns -1 for opposite vectors", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });

  it("returns 0 for zero vectors", () => {
    expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
  });

  it("handles high-dimensional vectors", () => {
    const a = Array.from({ length: 1536 }, (_, i) => Math.sin(i));
    const b = Array.from({ length: 1536 }, (_, i) => Math.sin(i + 0.01));
    const similarity = cosineSimilarity(a, b);
    expect(similarity).toBeGreaterThan(0.99);
    expect(similarity).toBeLessThanOrEqual(1);
  });
});

describe("cosineDrift", () => {
  it("returns 0 for identical embeddings", () => {
    const current = [1, 2, 3];
    const baselines = [[1, 2, 3]];
    expect(cosineDrift(current, baselines)).toBeCloseTo(0);
  });

  it("returns drift close to 1 for very different embeddings", () => {
    const current = [1, 0, 0];
    const baselines = [[0, 0, 1]];
    expect(cosineDrift(current, baselines)).toBeCloseTo(1);
  });

  it("picks the nearest baseline (lowest drift)", () => {
    const current = [1, 0, 0];
    const baselines = [
      [0, 1, 0], // orthogonal, drift = 1
      [0.9, 0.1, 0], // similar, low drift
    ];
    const drift = cosineDrift(current, baselines);
    expect(drift).toBeLessThan(0.1);
  });

  it("returns 1 for empty baselines", () => {
    expect(cosineDrift([1, 2, 3], [])).toBe(1);
  });
});
