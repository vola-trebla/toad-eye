import { describe, it, expect, vi, beforeEach } from "vitest";

// Shared mock span
const mockSpan = {
  setAttributes: vi.fn(),
  setStatus: vi.fn(),
  end: vi.fn(),
};

vi.mock("@opentelemetry/api", () => ({
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
}));

// Mock all metrics recording functions
const mockRecordResponseEmpty = vi.fn();
const mockRecordResponseLatencyPerToken = vi.fn();

vi.mock("../core/metrics.js", () => ({
  recordRequestDuration: vi.fn(),
  recordRequestCost: vi.fn(),
  recordTokens: vi.fn(),
  recordRequest: vi.fn(),
  recordError: vi.fn(),
  recordBudgetExceeded: vi.fn(),
  recordBudgetBlocked: vi.fn(),
  recordBudgetDowngraded: vi.fn(),
  recordResponseEmpty: mockRecordResponseEmpty,
  recordResponseLatencyPerToken: mockRecordResponseLatencyPerToken,
}));

vi.mock("../core/tracer.js", () => ({
  getConfig: () => ({}),
  getBudgetTracker: () => null,
}));

const { traceLLMCall } = await import("../core/spans.js");

describe("proxy metric: llm.response.empty_rate", () => {
  beforeEach(() => {
    mockSpan.setAttributes.mockClear();
    mockSpan.setStatus.mockClear();
    mockRecordResponseEmpty.mockClear();
    mockRecordResponseLatencyPerToken.mockClear();
  });

  it("records empty response when completion is empty string", async () => {
    await traceLLMCall(
      { provider: "openai", model: "gpt-4o", prompt: "ping" },
      async () => ({
        completion: "",
        inputTokens: 10,
        outputTokens: 0,
        cost: 0.001,
      }),
    );

    expect(mockRecordResponseEmpty).toHaveBeenCalledOnce();
    expect(mockRecordResponseEmpty).toHaveBeenCalledWith(
      "openai",
      "gpt-4o",
      undefined,
    );
  });

  it("records empty response when completion is whitespace-only", async () => {
    await traceLLMCall(
      { provider: "anthropic", model: "claude-3-5-sonnet", prompt: "ping" },
      async () => ({
        completion: "   \n\t  ",
        inputTokens: 5,
        outputTokens: 2,
        cost: 0.0005,
      }),
    );

    expect(mockRecordResponseEmpty).toHaveBeenCalledOnce();
    expect(mockRecordResponseEmpty).toHaveBeenCalledWith(
      "anthropic",
      "claude-3-5-sonnet",
      undefined,
    );
  });

  it("does not record empty response when completion has content", async () => {
    await traceLLMCall(
      { provider: "openai", model: "gpt-4o", prompt: "hello" },
      async () => ({
        completion: "Hello, world!",
        inputTokens: 10,
        outputTokens: 5,
        cost: 0.001,
      }),
    );

    expect(mockRecordResponseEmpty).not.toHaveBeenCalled();
  });

  it("passes FinOps attributes to empty response counter", async () => {
    await traceLLMCall(
      {
        provider: "openai",
        model: "gpt-4o",
        prompt: "test",
        attributes: { "toad_eye.team": "search", "toad_eye.feature": "query" },
      },
      async () => ({
        completion: "",
        inputTokens: 5,
        outputTokens: 0,
        cost: 0,
      }),
    );

    expect(mockRecordResponseEmpty).toHaveBeenCalledWith(
      "openai",
      "gpt-4o",
      expect.objectContaining({
        "toad_eye.team": "search",
        "toad_eye.feature": "query",
      }),
    );
  });
});

describe("proxy metric: llm.response.latency_per_token", () => {
  beforeEach(() => {
    mockRecordResponseEmpty.mockClear();
    mockRecordResponseLatencyPerToken.mockClear();
  });

  it("records latency_per_token when output tokens > 0", async () => {
    await traceLLMCall(
      { provider: "openai", model: "gpt-4o", prompt: "compute" },
      async () => ({
        completion: "result",
        inputTokens: 10,
        outputTokens: 20,
        cost: 0.002,
      }),
    );

    expect(mockRecordResponseLatencyPerToken).toHaveBeenCalledOnce();
    const [msPerToken, provider, model] =
      mockRecordResponseLatencyPerToken.mock.calls[0]!;
    expect(typeof msPerToken).toBe("number");
    expect(msPerToken).toBeGreaterThanOrEqual(0);
    expect(provider).toBe("openai");
    expect(model).toBe("gpt-4o");
  });

  it("skips latency_per_token when output tokens is zero", async () => {
    await traceLLMCall(
      { provider: "openai", model: "gpt-4o", prompt: "test" },
      async () => ({
        completion: "",
        inputTokens: 5,
        outputTokens: 0,
        cost: 0,
      }),
    );

    expect(mockRecordResponseLatencyPerToken).not.toHaveBeenCalled();
  });

  it("passes FinOps attributes to latency_per_token histogram", async () => {
    await traceLLMCall(
      {
        provider: "gemini",
        model: "gemini-pro",
        prompt: "test",
        attributes: { "toad_eye.environment": "prod" },
      },
      async () => ({
        completion: "ok",
        inputTokens: 8,
        outputTokens: 4,
        cost: 0.001,
      }),
    );

    expect(mockRecordResponseLatencyPerToken).toHaveBeenCalledWith(
      expect.any(Number),
      "gemini",
      "gemini-pro",
      expect.objectContaining({ "toad_eye.environment": "prod" }),
    );
  });

  it("does not record proxy metrics on LLM call error", async () => {
    await traceLLMCall(
      { provider: "openai", model: "gpt-4o", prompt: "fail" },
      async () => {
        throw new Error("rate limit");
      },
    ).catch(() => {});

    expect(mockRecordResponseEmpty).not.toHaveBeenCalled();
    expect(mockRecordResponseLatencyPerToken).not.toHaveBeenCalled();
  });
});
