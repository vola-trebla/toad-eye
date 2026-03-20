import { describe, it, expect, vi, beforeEach } from "vitest";

// Shared mock span — accessible in tests for assertion
const mockSpan = {
  setAttributes: vi.fn(),
  setStatus: vi.fn(),
  end: vi.fn(),
};

// Mock tracer before importing spans
vi.mock("@opentelemetry/api", () => {
  return {
    trace: {
      getTracer: () => ({
        startActiveSpan: (
          _name: string,
          fn: (span: typeof mockSpan) => unknown,
        ) => fn(mockSpan),
      }),
    },
    SpanStatusCode: { OK: 0, ERROR: 2 },
    metrics: { getMeter: () => ({}) },
    diag: { warn: vi.fn(), debug: vi.fn() },
  };
});

// Mock metrics to avoid initialization
vi.mock("../core/metrics.js", () => ({
  recordRequestDuration: vi.fn(),
  recordRequestCost: vi.fn(),
  recordTokens: vi.fn(),
  recordRequest: vi.fn(),
  recordError: vi.fn(),
  recordBudgetExceeded: vi.fn(),
  recordBudgetBlocked: vi.fn(),
  recordBudgetDowngraded: vi.fn(),
}));

// Mock tracer config
let mockConfig: Record<string, unknown> = {};
vi.mock("../core/tracer.js", () => ({
  getConfig: () => mockConfig,
  getBudgetTracker: () => null,
}));

const { traceLLMCall } = await import("../core/spans.js");

describe("traceLLMCall", () => {
  beforeEach(() => {
    mockConfig = {};
    mockSpan.setAttributes.mockClear();
    mockSpan.setStatus.mockClear();
  });

  it("returns output from wrapped function", async () => {
    const output = await traceLLMCall(
      { provider: "openai", model: "gpt-4o", prompt: "hello" },
      async () => ({
        completion: "world",
        inputTokens: 10,
        outputTokens: 5,
        cost: 0.001,
      }),
    );
    expect(output.completion).toBe("world");
    expect(output.inputTokens).toBe(10);
  });

  it("rethrows errors from wrapped function", async () => {
    await expect(
      traceLLMCall(
        { provider: "openai", model: "gpt-4o", prompt: "hello" },
        async () => {
          throw new Error("API error");
        },
      ),
    ).rejects.toThrow("API error");
  });
});

describe("privacy — processContent", () => {
  beforeEach(() => {
    mockConfig = {};
    mockSpan.setAttributes.mockClear();
    mockSpan.setStatus.mockClear();
  });

  it("records content by default", async () => {
    const output = await traceLLMCall(
      { provider: "openai", model: "gpt-4o", prompt: "secret data" },
      async () => ({
        completion: "response",
        inputTokens: 10,
        outputTokens: 5,
        cost: 0,
      }),
    );
    expect(output.completion).toBe("response");
  });

  it("skips content when recordContent is false", async () => {
    mockConfig = { recordContent: false };
    // The function still returns the real output — privacy only affects spans
    const output = await traceLLMCall(
      { provider: "openai", model: "gpt-4o", prompt: "secret" },
      async () => ({
        completion: "response",
        inputTokens: 10,
        outputTokens: 5,
        cost: 0,
      }),
    );
    expect(output.completion).toBe("response");
  });
});

describe("privacy — error messages (#92)", () => {
  beforeEach(() => {
    mockConfig = {};
    mockSpan.setAttributes.mockClear();
    mockSpan.setStatus.mockClear();
  });

  it("redacts PII from error messages", async () => {
    mockConfig = { redactPatterns: [/\b\S+@\S+\.\S+\b/g] };

    await traceLLMCall(
      { provider: "openai", model: "gpt-4o", prompt: "test" },
      async () => {
        throw new Error("Rate limit for user john@secret.com exceeded");
      },
    ).catch(() => {});

    // Find the setAttributes call that contains error status
    const errorCall = mockSpan.setAttributes.mock.calls.find(
      (call: unknown[]) =>
        (call[0] as Record<string, unknown>)["gen_ai.toad_eye.status"] ===
        "error",
    );
    expect(errorCall).toBeDefined();
    const attrs = errorCall![0] as Record<string, unknown>;
    expect(attrs["error.type"]).toBe("Rate limit for user [REDACTED] exceeded");
    expect(attrs["error.type"]).not.toContain("john@secret.com");
  });

  it("suppresses error message when recordContent is false", async () => {
    mockConfig = { recordContent: false };

    await traceLLMCall(
      { provider: "openai", model: "gpt-4o", prompt: "test" },
      async () => {
        throw new Error("Secret error with PII");
      },
    ).catch(() => {});

    const errorCall = mockSpan.setAttributes.mock.calls.find(
      (call: unknown[]) =>
        (call[0] as Record<string, unknown>)["gen_ai.toad_eye.status"] ===
        "error",
    );
    expect(errorCall).toBeDefined();
    const attrs = errorCall![0] as Record<string, unknown>;
    // error.type should NOT be present when recordContent is false
    expect(attrs["error.type"]).toBeUndefined();
  });

  it("hashes error message when hashContent is true", async () => {
    mockConfig = { hashContent: true };

    await traceLLMCall(
      { provider: "openai", model: "gpt-4o", prompt: "test" },
      async () => {
        throw new Error("Sensitive error details");
      },
    ).catch(() => {});

    const errorCall = mockSpan.setAttributes.mock.calls.find(
      (call: unknown[]) =>
        (call[0] as Record<string, unknown>)["gen_ai.toad_eye.status"] ===
        "error",
    );
    expect(errorCall).toBeDefined();
    const attrs = errorCall![0] as Record<string, unknown>;
    expect(attrs["error.type"]).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
});

describe("FinOps attributes", () => {
  beforeEach(() => {
    mockConfig = {};
  });

  it("passes per-request attributes through to metrics", async () => {
    const { recordRequest } = await import("../core/metrics.js");

    await traceLLMCall(
      {
        provider: "openai",
        model: "gpt-4o",
        prompt: "test",
        attributes: {
          "toad_eye.team": "checkout",
          "toad_eye.feature": "order-summary",
        },
      },
      async () => ({
        completion: "ok",
        inputTokens: 10,
        outputTokens: 5,
        cost: 0.01,
      }),
    );

    expect(recordRequest).toHaveBeenCalledWith(
      "openai",
      "gpt-4o",
      expect.objectContaining({
        "toad_eye.team": "checkout",
        "toad_eye.feature": "order-summary",
      }),
    );
  });

  it("merges global and per-request attributes (per-request wins)", async () => {
    mockConfig = {
      attributes: {
        "toad_eye.team": "global-team",
        "toad_eye.environment": "prod",
      },
    };

    const { recordRequest } = await import("../core/metrics.js");

    await traceLLMCall(
      {
        provider: "anthropic",
        model: "claude-sonnet",
        prompt: "test",
        attributes: { "toad_eye.team": "override-team" },
      },
      async () => ({
        completion: "ok",
        inputTokens: 5,
        outputTokens: 3,
        cost: 0.005,
      }),
    );

    expect(recordRequest).toHaveBeenCalledWith(
      "anthropic",
      "claude-sonnet",
      expect.objectContaining({
        "toad_eye.team": "override-team",
        "toad_eye.environment": "prod",
      }),
    );
  });
});
