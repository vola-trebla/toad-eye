import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock tracer before importing spans
vi.mock("@opentelemetry/api", () => {
  const mockSpan = {
    setAttributes: vi.fn(),
    setStatus: vi.fn(),
    end: vi.fn(),
  };
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
}));

// Mock tracer config
let mockConfig: Record<string, unknown> = {};
vi.mock("../core/tracer.js", () => ({
  getConfig: () => mockConfig,
}));

const { traceLLMCall } = await import("../core/spans.js");

describe("traceLLMCall", () => {
  beforeEach(() => {
    mockConfig = {};
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
