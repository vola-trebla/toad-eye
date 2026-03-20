import { describe, it, expect, vi, beforeEach } from "vitest";

import { BudgetTracker } from "../budget/tracker.js";
import { ToadBudgetExceededError } from "../budget/error.js";

describe("BudgetTracker", () => {
  describe("daily budget", () => {
    it("allows calls within budget", () => {
      const tracker = new BudgetTracker({ daily: 10 }, "block");
      expect(tracker.checkBefore("openai", "gpt-4o")).toBeNull();
    });

    it("blocks when daily budget is exceeded", () => {
      const tracker = new BudgetTracker({ daily: 1 }, "block");

      // Record cost that exceeds budget
      tracker.recordCost(1.5, "gpt-4o");

      expect(() => tracker.checkBefore("openai", "gpt-4o")).toThrow(
        ToadBudgetExceededError,
      );
    });

    it("warns but does not block in warn mode", () => {
      const tracker = new BudgetTracker({ daily: 1 }, "warn");

      tracker.recordCost(1.5, "gpt-4o");

      // Should not throw — warn mode just continues
      expect(tracker.checkBefore("openai", "gpt-4o")).toBeNull();
    });

    it("calls downgrade callback when budget exceeded in downgrade mode", () => {
      const downgrade = vi.fn().mockReturnValue({
        provider: "openai",
        model: "gpt-4o-mini",
      });
      const tracker = new BudgetTracker({ daily: 1 }, "downgrade", downgrade);

      tracker.recordCost(1.5, "gpt-4o");

      const result = tracker.checkBefore("openai", "gpt-4o");
      expect(downgrade).toHaveBeenCalledWith({
        provider: "openai",
        model: "gpt-4o",
      });
      expect(result).toEqual({ provider: "openai", model: "gpt-4o-mini" });
    });
  });

  describe("perModel budget", () => {
    it("blocks specific model when its budget is exceeded", () => {
      const tracker = new BudgetTracker({ perModel: { "gpt-4o": 5 } }, "block");

      tracker.recordCost(6, "gpt-4o");

      expect(() => tracker.checkBefore("openai", "gpt-4o")).toThrow(
        ToadBudgetExceededError,
      );
    });

    it("allows different model within its budget", () => {
      const tracker = new BudgetTracker({ perModel: { "gpt-4o": 5 } }, "block");

      tracker.recordCost(6, "gpt-4o");

      // gpt-4o-mini has no limit set, should pass
      expect(tracker.checkBefore("openai", "gpt-4o-mini")).toBeNull();
    });
  });

  describe("perUser budget", () => {
    it("blocks user when their budget is exceeded", () => {
      const tracker = new BudgetTracker({ perUser: 2 }, "block");

      tracker.recordCost(3, "gpt-4o", "user-123");

      expect(() => tracker.checkBefore("openai", "gpt-4o", "user-123")).toThrow(
        ToadBudgetExceededError,
      );
    });

    it("allows different user within budget", () => {
      const tracker = new BudgetTracker({ perUser: 2 }, "block");

      tracker.recordCost(3, "gpt-4o", "user-123");

      // user-456 has no spend, should pass
      expect(tracker.checkBefore("openai", "gpt-4o", "user-456")).toBeNull();
    });

    it("ignores perUser when no userId provided", () => {
      const tracker = new BudgetTracker({ perUser: 2 }, "block");

      tracker.recordCost(3, "gpt-4o");

      // No userId — perUser check skipped
      expect(tracker.checkBefore("openai", "gpt-4o")).toBeNull();
    });
  });

  describe("recordCost", () => {
    it("returns null when within budget", () => {
      const tracker = new BudgetTracker({ daily: 100 }, "warn");
      const result = tracker.recordCost(5, "gpt-4o");
      expect(result).toBeNull();
    });

    it("returns exceeded info when budget is crossed", () => {
      const tracker = new BudgetTracker({ daily: 10 }, "warn");

      tracker.recordCost(8, "gpt-4o");
      const result = tracker.recordCost(5, "gpt-4o");

      expect(result).toEqual({
        budget: "daily",
        limit: 10,
        current: 13,
      });
    });
  });

  describe("getUsagePercent", () => {
    it("returns 0 when no budget set", () => {
      const tracker = new BudgetTracker({}, "warn");
      expect(tracker.getUsagePercent()).toBe(0);
    });

    it("returns correct percentage", () => {
      const tracker = new BudgetTracker({ daily: 100 }, "warn");
      tracker.recordCost(75, "gpt-4o");
      expect(tracker.getUsagePercent()).toBe(75);
    });
  });

  describe("ToadBudgetExceededError", () => {
    it("has correct message for daily budget", () => {
      const error = new ToadBudgetExceededError({
        budget: "daily",
        limit: 50,
        current: 52.3,
      });
      expect(error.message).toContain("daily budget exceeded");
      expect(error.message).toContain("$50");
      expect(error.message).toContain("$52.30");
      expect(error.name).toBe("ToadBudgetExceededError");
    });

    it("includes model info for perModel budget", () => {
      const error = new ToadBudgetExceededError({
        budget: "perModel",
        limit: 30,
        current: 31,
        model: "gpt-4o",
      });
      expect(error.message).toContain("model gpt-4o");
      expect(error.model).toBe("gpt-4o");
    });

    it("includes userId for perUser budget", () => {
      const error = new ToadBudgetExceededError({
        budget: "perUser",
        limit: 5,
        current: 6,
        userId: "user-123",
      });
      expect(error.message).toContain("user user-123");
      expect(error.userId).toBe("user-123");
    });
  });

  describe("state persistence", () => {
    it("restores state from saved data", () => {
      const tracker = new BudgetTracker({ daily: 10 }, "block");
      const today = new Date().toISOString().slice(0, 10);

      tracker.restoreState({
        date: today,
        totalCost: 9,
        perUser: { "user-1": 4 },
        perModel: { "gpt-4o": 7 },
      });

      // Should be nearly at budget
      expect(tracker.getUsagePercent()).toBe(90);
    });

    it("ignores stale state from previous day", () => {
      const tracker = new BudgetTracker({ daily: 10 }, "block");

      tracker.restoreState({
        date: "2020-01-01",
        totalCost: 100,
        perUser: {},
        perModel: {},
      });

      // Should be fresh — stale state ignored
      expect(tracker.getUsagePercent()).toBe(0);
    });
  });
});
