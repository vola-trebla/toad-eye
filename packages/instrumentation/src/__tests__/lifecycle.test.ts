import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../core/metrics.js", () => ({
  recordRequest: vi.fn(),
  recordRequestDuration: vi.fn(),
  recordRequestCost: vi.fn(),
  recordTokens: vi.fn(),
  recordResponseEmpty: vi.fn(),
  recordResponseLatencyPerToken: vi.fn(),
  recordContextUtilization: vi.fn(),
  recordContextBlocked: vi.fn(),
  recordBudgetExceeded: vi.fn(),
  recordBudgetDowngraded: vi.fn(),
  recordBudgetBlocked: vi.fn(),
  recordError: vi.fn(),
}));

vi.mock("../core/tracer.js", () => ({
  getConfig: vi.fn(() => null),
  getBudgetTracker: vi.fn(() => null),
}));

vi.mock("../core/pricing.js", () => ({
  calculateCost: vi.fn(() => 0.01),
  getModelPricing: vi.fn(() => null),
}));

import {
  recordSuccessMetrics,
  evaluateContextGuard,
  recordBudgetPostCheck,
  handleErrorMetrics,
} from "../core/lifecycle.js";

import {
  recordRequest,
  recordRequestDuration,
  recordRequestCost,
  recordTokens,
  recordResponseEmpty,
  recordResponseLatencyPerToken,
  recordContextUtilization,
  recordContextBlocked,
  recordBudgetExceeded,
  recordBudgetBlocked,
  recordError,
} from "../core/metrics.js";

import { getConfig } from "../core/tracer.js";
import { getModelPricing } from "../core/pricing.js";
import { ToadBudgetExceededError } from "../budget/index.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("recordSuccessMetrics", () => {
  it("records all success metrics", () => {
    recordSuccessMetrics({
      duration: 1000,
      provider: "openai",
      model: "gpt-4o",
      cost: 0.05,
      inputTokens: 100,
      outputTokens: 50,
      completion: "Hello world",
      attrs: { team: "checkout" },
    });

    expect(recordRequest).toHaveBeenCalledWith("openai", "gpt-4o", {
      team: "checkout",
    });
    expect(recordRequestDuration).toHaveBeenCalledWith(
      1000,
      "openai",
      "gpt-4o",
      { team: "checkout" },
    );
    expect(recordRequestCost).toHaveBeenCalledWith(0.05, "openai", "gpt-4o", {
      team: "checkout",
    });
    expect(recordTokens).toHaveBeenCalledWith(150, "openai", "gpt-4o", {
      team: "checkout",
    });
    expect(recordResponseEmpty).not.toHaveBeenCalled();
    expect(recordResponseLatencyPerToken).toHaveBeenCalledWith(
      20,
      "openai",
      "gpt-4o",
      { team: "checkout" },
    );
  });

  it("records empty response metric", () => {
    recordSuccessMetrics({
      duration: 500,
      provider: "openai",
      model: "gpt-4o",
      cost: 0.01,
      inputTokens: 50,
      outputTokens: 0,
      completion: "   ",
    });

    expect(recordResponseEmpty).toHaveBeenCalledWith(
      "openai",
      "gpt-4o",
      undefined,
    );
    expect(recordResponseLatencyPerToken).not.toHaveBeenCalled();
  });
});

describe("evaluateContextGuard", () => {
  it("does nothing when no pricing info", () => {
    const span = { setAttribute: vi.fn(), addEvent: vi.fn() };
    evaluateContextGuard(span as never, "gpt-4o", "openai", 100);
    expect(span.setAttribute).not.toHaveBeenCalled();
  });

  it("records utilization when pricing available", () => {
    vi.mocked(getModelPricing).mockReturnValue({
      inputPer1M: 5,
      outputPer1M: 15,
      maxContextTokens: 1000,
    });
    vi.mocked(getConfig).mockReturnValue({
      serviceName: "test",
    });

    const span = { setAttribute: vi.fn(), addEvent: vi.fn() };
    evaluateContextGuard(span as never, "gpt-4o", "openai", 500);

    expect(span.setAttribute).toHaveBeenCalledWith(
      "gen_ai.toad_eye.context_utilization",
      0.5,
    );
    expect(recordContextUtilization).toHaveBeenCalledWith(
      0.5,
      "openai",
      "gpt-4o",
    );
    expect(recordContextBlocked).not.toHaveBeenCalled();
  });

  it("triggers alert when utilization exceeds alertAt", () => {
    vi.mocked(getModelPricing).mockReturnValue({
      inputPer1M: 5,
      outputPer1M: 15,
      maxContextTokens: 1000,
    });
    vi.mocked(getConfig).mockReturnValue({
      serviceName: "test",
      contextGuard: { alertAt: 0.8 },
    });

    const span = { setAttribute: vi.fn(), addEvent: vi.fn() };
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    evaluateContextGuard(span as never, "gpt-4o", "openai", 900);

    expect(recordContextBlocked).toHaveBeenCalledWith("gpt-4o");
    expect(span.addEvent).toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe("recordBudgetPostCheck", () => {
  it("does nothing without budget", () => {
    recordBudgetPostCheck(null, 0.05, "gpt-4o", undefined, 0.01);
    expect(recordBudgetExceeded).not.toHaveBeenCalled();
  });

  it("warns when budget exceeded", () => {
    const budget = {
      recordCost: vi.fn(() => ({ budget: "daily", limit: 50, current: 51 })),
    };
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    recordBudgetPostCheck(budget as never, 0.05, "gpt-4o", "user-1", 0.01);

    expect(budget.recordCost).toHaveBeenCalledWith(
      0.05,
      "gpt-4o",
      "user-1",
      0.01,
    );
    expect(recordBudgetExceeded).toHaveBeenCalledWith("daily");
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe("handleErrorMetrics", () => {
  it("records error metrics and releases budget reservation", () => {
    const budget = { releaseReservation: vi.fn() };

    handleErrorMetrics(
      new Error("timeout"),
      500,
      "openai",
      "gpt-4o",
      budget as never,
      0.01,
      { team: "api" },
    );

    expect(recordRequest).toHaveBeenCalledWith("openai", "gpt-4o", {
      team: "api",
    });
    expect(recordRequestDuration).toHaveBeenCalledWith(
      500,
      "openai",
      "gpt-4o",
      { team: "api" },
    );
    expect(budget.releaseReservation).toHaveBeenCalledWith(0.01);
    expect(recordError).toHaveBeenCalledWith("openai", "gpt-4o", {
      team: "api",
    });
    expect(recordBudgetBlocked).not.toHaveBeenCalled();
  });

  it("records budget blocked instead of error for ToadBudgetExceededError", () => {
    const budget = { releaseReservation: vi.fn() };
    const error = new ToadBudgetExceededError({
      budget: "daily",
      limit: 50,
      current: 51,
      model: "gpt-4o",
    });

    handleErrorMetrics(error, 100, "openai", "gpt-4o", budget as never, 0.01);

    expect(recordBudgetBlocked).toHaveBeenCalledWith("daily");
    expect(recordError).not.toHaveBeenCalled();
  });

  it("works without budget tracker", () => {
    handleErrorMetrics(new Error("fail"), 200, "openai", "gpt-4o", null, 0);

    expect(recordError).toHaveBeenCalled();
  });
});
