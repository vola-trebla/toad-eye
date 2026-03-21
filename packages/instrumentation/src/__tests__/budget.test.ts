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
      expect(result).toEqual({
        provider: "openai",
        model: "gpt-4o-mini",
        budget: "daily",
      });
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

  describe("cost reservation (race condition guard)", () => {
    it("counts in-flight reservations against daily budget", () => {
      const tracker = new BudgetTracker({ daily: 1 }, "block");
      // Reserve $0.80 — simulate an in-flight request
      tracker.checkBefore("openai", "gpt-4o", undefined, 0.8);
      // Second request estimates $0.30 — total reserved+actual would be $1.10, over limit
      expect(() =>
        tracker.checkBefore("openai", "gpt-4o", undefined, 0.3),
      ).toThrow(ToadBudgetExceededError);
    });

    it("releases reservation when recordCost is called", () => {
      const tracker = new BudgetTracker({ daily: 1 }, "block");
      tracker.checkBefore("openai", "gpt-4o", undefined, 0.8);
      // Record actual cost — releases the $0.80 reservation
      tracker.recordCost(0.5, "gpt-4o", undefined, 0.8);
      // Now only $0.50 is used; a new request with $0.30 estimate should pass
      expect(
        tracker.checkBefore("openai", "gpt-4o", undefined, 0.3),
      ).toBeNull();
    });

    it("releases reservation via releaseReservation on error", () => {
      const tracker = new BudgetTracker({ daily: 1 }, "block");
      tracker.checkBefore("openai", "gpt-4o", undefined, 0.8);
      // Simulate LLM call failure — release without recording cost
      tracker.releaseReservation(0.8);
      // Budget should be free again
      expect(
        tracker.checkBefore("openai", "gpt-4o", undefined, 0.3),
      ).toBeNull();
    });

    it("reservation does not affect perUser or perModel checks", () => {
      const tracker = new BudgetTracker({ perModel: { "gpt-4o": 5 } }, "block");
      // Large reservation — but perModel is checked separately, not via reservedCost
      tracker.checkBefore("openai", "gpt-4o", undefined, 100);
      // perModel check: $0 recorded, still within $5 limit
      expect(tracker.checkBefore("openai", "gpt-4o", undefined, 0)).toBeNull();
    });

    it("downgrade result includes budget type that triggered it", () => {
      const downgrade = vi
        .fn()
        .mockReturnValue({ provider: "openai", model: "gpt-4o-mini" });
      const tracker = new BudgetTracker({ daily: 1 }, "downgrade", downgrade);
      tracker.recordCost(1.5, "gpt-4o");
      const result = tracker.checkBefore("openai", "gpt-4o");
      expect(result?.budget).toBe("daily");
    });

    it("blocked call does not add reservation", () => {
      const tracker = new BudgetTracker({ daily: 1 }, "block");
      tracker.recordCost(1.5, "gpt-4o");
      // This will throw — no reservation should be added
      expect(() =>
        tracker.checkBefore("openai", "gpt-4o", undefined, 0.5),
      ).toThrow(ToadBudgetExceededError);
      // After block, state.reservedCost should still be 0
      expect(tracker.getState().reservedCost).toBe(0);
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
