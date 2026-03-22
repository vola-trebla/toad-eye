import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSpan = {
  setAttribute: vi.fn(),
  setAttributes: vi.fn(),
  setStatus: vi.fn(),
  addEvent: vi.fn(),
  end: vi.fn(),
};

let lastSpanName = "";
let lastActiveSpanName = "";

vi.mock("@opentelemetry/api", () => ({
  trace: {
    getTracer: () => ({
      startSpan: (name: string) => {
        lastSpanName = name;
        return mockSpan;
      },
      startActiveSpan: (
        name: string,
        fn: (span: typeof mockSpan) => unknown,
      ) => {
        lastActiveSpanName = name;
        return fn(mockSpan);
      },
    }),
  },
  SpanStatusCode: { OK: 0, ERROR: 2 },
  metrics: { getMeter: () => ({}) },
  diag: { warn: vi.fn(), debug: vi.fn() },
}));

const mockRecordAgentSteps = vi.fn();
const mockRecordAgentToolUsage = vi.fn();

vi.mock("../core/metrics.js", () => ({
  recordAgentSteps: (...args: unknown[]) => mockRecordAgentSteps(...args),
  recordAgentToolUsage: (...args: unknown[]) =>
    mockRecordAgentToolUsage(...args),
}));

let mockConfig: Record<string, unknown> = {};
let mockEmitDeprecated = true;
vi.mock("../core/tracer.js", () => ({
  getConfig: () => mockConfig,
  shouldEmitDeprecatedAttrs: () => mockEmitDeprecated,
}));

const { traceAgentStep, traceAgentQuery } = await import("../agent.js");

describe("traceAgentStep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig = {};
    mockEmitDeprecated = true;
    lastSpanName = "";
    lastActiveSpanName = "";
  });

  it("uses execute_tool span name for act steps with toolName", () => {
    traceAgentStep({ type: "act", stepNumber: 1, toolName: "web-search" });

    expect(lastSpanName).toBe("execute_tool web-search");
  });

  it("uses gen_ai.agent.step.{type} span name for non-act steps", () => {
    traceAgentStep({ type: "think", stepNumber: 1 });

    expect(lastSpanName).toBe("gen_ai.agent.step.think");
  });

  it("uses gen_ai.agent.step.act span name for act steps without toolName", () => {
    traceAgentStep({ type: "act", stepNumber: 1 });

    expect(lastSpanName).toBe("gen_ai.agent.step.act");
  });

  it("creates a span with step type and number (toad_eye namespace)", () => {
    traceAgentStep({ type: "think", stepNumber: 1 });

    expect(mockSpan.setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        "gen_ai.toad_eye.agent.step.type": "think",
        "gen_ai.toad_eye.agent.step.number": 1,
      }),
    );
    expect(mockSpan.end).toHaveBeenCalled();
  });

  it("emits deprecated gen_ai.agent.step.* aliases alongside new toad_eye attrs", () => {
    traceAgentStep({ type: "think", stepNumber: 1 });

    expect(mockSpan.setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        "gen_ai.agent.step.type": "think",
        "gen_ai.agent.step.number": 1,
      }),
    );
  });

  it("emits both gen_ai.tool.name and gen_ai.agent.tool.name for act steps", () => {
    traceAgentStep({ type: "act", stepNumber: 2, toolName: "web-search" });

    expect(mockSpan.setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        "gen_ai.tool.name": "web-search",
        "gen_ai.agent.tool.name": "web-search",
      }),
    );
  });

  it("records gen_ai.tool.type when provided", () => {
    traceAgentStep({
      type: "act",
      stepNumber: 2,
      toolName: "search",
      toolType: "function",
    });

    expect(mockSpan.setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        "gen_ai.tool.type": "function",
      }),
    );
  });

  it("omits gen_ai.tool.type when not provided", () => {
    traceAgentStep({ type: "act", stepNumber: 2, toolName: "search" });

    const attrs = mockSpan.setAttributes.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(attrs).not.toHaveProperty("gen_ai.tool.type");
  });

  it("records tool usage metric for act steps", () => {
    traceAgentStep({ type: "act", stepNumber: 2, toolName: "web-search" });

    expect(mockRecordAgentToolUsage).toHaveBeenCalledWith(
      "web-search",
      "success",
    );
  });

  it("does not record tool usage for non-act steps", () => {
    traceAgentStep({ type: "think", stepNumber: 1 });

    expect(mockRecordAgentToolUsage).not.toHaveBeenCalled();
  });

  it("includes content in toad_eye namespace when recordContent is enabled", () => {
    traceAgentStep({ type: "think", stepNumber: 1, content: "reasoning here" });

    expect(mockSpan.setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        "gen_ai.toad_eye.agent.step.content": "reasoning here",
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
    expect(attrs).not.toHaveProperty("gen_ai.toad_eye.agent.step.content");
    expect(attrs).not.toHaveProperty("gen_ai.agent.step.content");
  });

  it("skips deprecated aliases when OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental", () => {
    mockEmitDeprecated = false;
    traceAgentStep({ type: "act", stepNumber: 2, toolName: "search" });

    const attrs = mockSpan.setAttributes.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    // Canonical attrs present
    expect(attrs).toHaveProperty("gen_ai.toad_eye.agent.step.type", "act");
    expect(attrs).toHaveProperty("gen_ai.tool.name", "search");
    // Deprecated aliases absent
    expect(attrs).not.toHaveProperty("gen_ai.agent.step.type");
    expect(attrs).not.toHaveProperty("gen_ai.agent.tool.name");
  });
});

describe("traceAgentQuery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig = {};
    mockEmitDeprecated = true;
    lastSpanName = "";
    lastActiveSpanName = "";
  });

  it("uses invoke_agent span name for string form", async () => {
    await traceAgentQuery("test query", async () => "result");

    expect(lastActiveSpanName).toBe("invoke_agent");
  });

  it("uses invoke_agent {agentName} span name when agentName provided", async () => {
    await traceAgentQuery(
      { query: "test", agentName: "space-monitor" },
      async () => "result",
    );

    expect(lastActiveSpanName).toBe("invoke_agent space-monitor");
  });

  it("records gen_ai.agent.name attribute when agentName provided", async () => {
    await traceAgentQuery(
      { query: "test", agentName: "space-monitor" },
      async () => "result",
    );

    expect(mockSpan.setAttribute).toHaveBeenCalledWith(
      "gen_ai.agent.name",
      "space-monitor",
    );
  });

  it("records gen_ai.agent.id attribute when agentId provided", async () => {
    await traceAgentQuery(
      { query: "test", agentName: "space-monitor", agentId: "agent-001" },
      async () => "result",
    );

    expect(mockSpan.setAttribute).toHaveBeenCalledWith(
      "gen_ai.agent.id",
      "agent-001",
    );
  });

  it("accepts object form without agentName (defaults to invoke_agent span name)", async () => {
    await traceAgentQuery({ query: "test" }, async () => "result");

    expect(lastActiveSpanName).toBe("invoke_agent");
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

describe("handoff steps (#133)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig = {};
  });

  it("records handoff attributes in toad_eye namespace + deprecated aliases", () => {
    traceAgentStep({
      type: "handoff",
      stepNumber: 3,
      toAgent: "specialist",
      handoffReason: "needs domain expertise",
    });

    expect(mockSpan.setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        // New toad_eye namespace (canonical)
        "gen_ai.toad_eye.agent.step.type": "handoff",
        "gen_ai.toad_eye.agent.handoff.to": "specialist",
        "gen_ai.toad_eye.agent.handoff.reason": "needs domain expertise",
        // Deprecated aliases (backward compat)
        "gen_ai.agent.step.type": "handoff",
        "gen_ai.agent.handoff.to": "specialist",
        "gen_ai.agent.handoff.reason": "needs domain expertise",
      }),
    );
  });
});

describe("loop detection (#133)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig = {};
  });

  it("counts observe→think transitions as loops", async () => {
    await traceAgentQuery("test", async (step) => {
      step({ type: "think", stepNumber: 1 });
      step({ type: "act", stepNumber: 2, toolName: "search" });
      step({ type: "observe", stepNumber: 3 });
      // Loop 1: observe → think
      step({ type: "think", stepNumber: 4 });
      step({ type: "act", stepNumber: 5, toolName: "search" });
      step({ type: "observe", stepNumber: 6 });
      // Loop 2: observe → think
      step({ type: "think", stepNumber: 7 });
      step({ type: "answer", stepNumber: 8 });
    });

    expect(mockSpan.setAttribute).toHaveBeenCalledWith(
      "gen_ai.toad_eye.agent.loop_count",
      2,
    );
    expect(mockSpan.setAttribute).toHaveBeenCalledWith(
      "gen_ai.agent.loop_count",
      2,
    );
  });

  it("records 0 loops for linear flow", async () => {
    await traceAgentQuery("test", async (step) => {
      step({ type: "think", stepNumber: 1 });
      step({ type: "act", stepNumber: 2, toolName: "calc" });
      step({ type: "observe", stepNumber: 3 });
      step({ type: "answer", stepNumber: 4 });
    });

    expect(mockSpan.setAttribute).toHaveBeenCalledWith(
      "gen_ai.toad_eye.agent.loop_count",
      0,
    );
    expect(mockSpan.setAttribute).toHaveBeenCalledWith(
      "gen_ai.agent.loop_count",
      0,
    );
  });

  it("emits warning when maxSteps exceeded", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await traceAgentQuery(
      "test",
      async (step) => {
        for (let i = 1; i <= 5; i++) {
          step({ type: "think", stepNumber: i });
        }
      },
      { maxSteps: 3 },
    );

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("exceeded maxSteps"),
    );
    expect(mockSpan.addEvent).toHaveBeenCalledWith(
      "agent.max_steps_exceeded",
      expect.objectContaining({
        "agent.max_steps": 3,
      }),
    );
    warnSpy.mockRestore();
  });

  it("does not warn when within maxSteps", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await traceAgentQuery("test", async (step) => {
      step({ type: "think", stepNumber: 1 });
      step({ type: "answer", stepNumber: 2 });
    });

    expect(warnSpy).not.toHaveBeenCalled();
    expect(mockSpan.addEvent).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
