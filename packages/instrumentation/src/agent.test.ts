import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSpan = {
  setAttribute: vi.fn(),
  setAttributes: vi.fn(),
  setStatus: vi.fn(),
  end: vi.fn(),
};

vi.mock("@opentelemetry/api", () => ({
  trace: {
    getTracer: () => ({
      startSpan: (_name: string) => mockSpan,
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

const mockRecordAgentSteps = vi.fn();
const mockRecordAgentToolUsage = vi.fn();

vi.mock("./metrics.js", () => ({
  recordAgentSteps: (...args: unknown[]) => mockRecordAgentSteps(...args),
  recordAgentToolUsage: (...args: unknown[]) =>
    mockRecordAgentToolUsage(...args),
}));

let mockConfig: Record<string, unknown> = {};
vi.mock("./tracer.js", () => ({
  getConfig: () => mockConfig,
}));

const { traceAgentStep, traceAgentQuery } = await import("./agent.js");

describe("traceAgentStep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig = {};
  });

  it("creates a span with step type and number", () => {
    traceAgentStep({ type: "think", stepNumber: 1 });

    expect(mockSpan.setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        "gen_ai.agent.step.type": "think",
        "gen_ai.agent.step.number": 1,
      }),
    );
    expect(mockSpan.end).toHaveBeenCalled();
  });

  it("includes toolName for act steps", () => {
    traceAgentStep({ type: "act", stepNumber: 2, toolName: "web-search" });

    expect(mockSpan.setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        "gen_ai.agent.tool.name": "web-search",
      }),
    );
  });

  it("records tool usage metric for act steps", () => {
    traceAgentStep({ type: "act", stepNumber: 2, toolName: "web-search" });

    expect(mockRecordAgentToolUsage).toHaveBeenCalledWith("web-search");
  });

  it("does not record tool usage for non-act steps", () => {
    traceAgentStep({ type: "think", stepNumber: 1 });

    expect(mockRecordAgentToolUsage).not.toHaveBeenCalled();
  });

  it("includes content when recordContent is enabled", () => {
    traceAgentStep({ type: "think", stepNumber: 1, content: "reasoning here" });

    expect(mockSpan.setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        "gen_ai.agent.step.content": "reasoning here",
      }),
    );
  });

  it("omits content when recordContent is false", () => {
    mockConfig = { recordContent: false };
    traceAgentStep({
      type: "think",
      stepNumber: 1,
      content: "secret reasoning",
    });

    const attrs = mockSpan.setAttributes.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(attrs).not.toHaveProperty("gen_ai.agent.step.content");
  });
});

describe("traceAgentQuery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig = {};
  });

  it("returns the result from the callback", async () => {
    const result = await traceAgentQuery("test query", async () => {
      return { answer: "42" };
    });

    expect(result).toEqual({ answer: "42" });
  });

  it("passes step function to callback and counts steps", async () => {
    await traceAgentQuery("test query", async (step) => {
      step({ type: "think", stepNumber: 1 });
      step({ type: "act", stepNumber: 2, toolName: "calc" });
      step({ type: "answer", stepNumber: 3 });
    });

    expect(mockRecordAgentSteps).toHaveBeenCalledWith(3);
  });

  it("records steps even when callback throws", async () => {
    await expect(
      traceAgentQuery("test query", async (step) => {
        step({ type: "think", stepNumber: 1 });
        throw new Error("agent failed");
      }),
    ).rejects.toThrow("agent failed");

    expect(mockRecordAgentSteps).toHaveBeenCalledWith(1);
  });

  it("sets error status on span when callback throws", async () => {
    await expect(
      traceAgentQuery("fail", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(mockSpan.setStatus).toHaveBeenCalledWith({
      code: 2,
      message: "boom",
    });
  });

  it("records query content in parent span", async () => {
    await traceAgentQuery("What is the weather?", async () => "sunny");

    expect(mockSpan.setAttribute).toHaveBeenCalledWith(
      "gen_ai.agent.step.content",
      "What is the weather?",
    );
  });

  it("omits query content when recordContent is false", async () => {
    mockConfig = { recordContent: false };
    await traceAgentQuery("secret query", async () => "result");

    expect(mockSpan.setAttribute).not.toHaveBeenCalledWith(
      "gen_ai.agent.step.content",
      expect.anything(),
    );
  });
});
