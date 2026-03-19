import { describe, it, expect } from "vitest";
import { parseCondition } from "./conditions.js";

describe("parseCondition", () => {
  it("parses standard condition: sum_1h > 10", () => {
    const result = parseCondition("sum_1h > 10");
    expect(result).toEqual({
      operator: "sum",
      window: "1h",
      comparator: ">",
      threshold: 10,
    });
  });

  it("parses rate condition: rate_5m > 0.05", () => {
    const result = parseCondition("rate_5m > 0.05");
    expect(result).toEqual({
      operator: "rate",
      window: "5m",
      comparator: ">",
      threshold: 0.05,
    });
  });

  it("parses ratio condition: ratio_15m > 0.05", () => {
    const result = parseCondition("ratio_15m > 0.05");
    expect(result).toEqual({
      operator: "ratio",
      window: "15m",
      comparator: ">",
      threshold: 0.05,
    });
  });

  it("parses baseline condition: p95_pct_5m_7d > 50", () => {
    const result = parseCondition("p95_pct_5m_7d > 50");
    expect(result).toEqual({
      operator: "p95_pct",
      window: "5m",
      baselineWindow: "7d",
      comparator: ">",
      threshold: 50,
    });
  });

  it("parses >= comparator", () => {
    const result = parseCondition("sum_1h >= 100");
    expect(result.comparator).toBe(">=");
    expect(result.threshold).toBe(100);
  });

  it("parses < comparator", () => {
    const result = parseCondition("avg_30m < 5");
    expect(result.comparator).toBe("<");
  });

  it("handles whitespace", () => {
    const result = parseCondition("  sum_1h  >  10  ");
    expect(result.threshold).toBe(10);
  });

  it("throws on invalid condition", () => {
    expect(() => parseCondition("invalid")).toThrow("Invalid alert condition");
  });

  it("throws on empty string", () => {
    expect(() => parseCondition("")).toThrow("Invalid alert condition");
  });

  it("parses seconds window", () => {
    const result = parseCondition("sum_30s > 5");
    expect(result.window).toBe("30s");
  });

  it("parses days window", () => {
    const result = parseCondition("sum_7d > 100");
    expect(result.window).toBe("7d");
  });
});
