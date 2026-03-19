import { describe, it, expect, beforeEach } from "vitest";
import { calculateCost, getModelPricing, setCustomPricing } from "./pricing.js";

describe("calculateCost", () => {
  it("calculates cost for known model", () => {
    const cost = calculateCost("gpt-4o", 1000, 500);
    // gpt-4o: input $2.5/1M, output $10/1M
    // (1000/1M * 2.5) + (500/1M * 10) = 0.0025 + 0.005 = 0.0075
    expect(cost).toBeCloseTo(0.0075, 6);
  });

  it("returns 0 for unknown model", () => {
    expect(calculateCost("unknown-model", 1000, 500)).toBe(0);
  });

  it("handles zero tokens", () => {
    expect(calculateCost("gpt-4o", 0, 0)).toBe(0);
  });
});

describe("getModelPricing", () => {
  it("returns pricing for built-in model", () => {
    const pricing = getModelPricing("gpt-4o");
    expect(pricing).toBeDefined();
    expect(pricing!.inputPer1M).toBe(2.5);
    expect(pricing!.outputPer1M).toBe(10);
  });

  it("returns undefined for unknown model", () => {
    expect(getModelPricing("nonexistent")).toBeUndefined();
  });
});

describe("setCustomPricing", () => {
  beforeEach(() => {
    setCustomPricing({});
  });

  it("overrides built-in pricing", () => {
    setCustomPricing({ "gpt-4o": { inputPer1M: 1, outputPer1M: 2 } });
    const pricing = getModelPricing("gpt-4o");
    expect(pricing!.inputPer1M).toBe(1);
    expect(pricing!.outputPer1M).toBe(2);
  });

  it("adds pricing for custom model", () => {
    setCustomPricing({ "my-model": { inputPer1M: 5, outputPer1M: 15 } });
    const cost = calculateCost("my-model", 1_000_000, 1_000_000);
    expect(cost).toBe(20);
  });
});
