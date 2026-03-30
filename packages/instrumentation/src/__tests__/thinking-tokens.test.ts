import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  afterEach,
} from "vitest";
import { trace } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";

// Mock metrics and tracer to avoid real OTel init
vi.mock("../core/metrics.js", () => ({
  recordRequest: vi.fn(),
  recordRequestDuration: vi.fn(),
  recordRequestCost: vi.fn(),
  recordTokens: vi.fn(),
  recordError: vi.fn(),
  recordBudgetExceeded: vi.fn(),
  recordBudgetBlocked: vi.fn(),
  recordBudgetDowngraded: vi.fn(),
  recordResponseEmpty: vi.fn(),
  recordResponseLatencyPerToken: vi.fn(),
  recordContextUtilization: vi.fn(),
  recordContextBlocked: vi.fn(),
  recordThinkingRatio: vi.fn(),
}));

vi.mock("../core/tracer.js", () => ({
  getConfig: vi.fn(() => ({ serviceName: "test", recordContent: true })),
  getBudgetTracker: vi.fn(() => null),
}));

vi.mock("../core/pricing.js", () => ({
  calculateCost: vi.fn(() => 0.01),
  getModelPricing: vi.fn(() => null),
}));

import { traceLLMCall } from "../core/spans.js";
import { recordThinkingRatio } from "../core/metrics.js";
import { getConfig } from "../core/tracer.js";

const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});

beforeAll(() => {
  trace.setGlobalTracerProvider(provider);
});

afterEach(() => {
  exporter.reset();
  vi.clearAllMocks();
});

afterAll(async () => {
  await provider.shutdown();
  trace.disable();
});

describe("thinking/reasoning token support", () => {
  it("records thinking tokens and ratio on span", async () => {
    await traceLLMCall(
      { provider: "openai", model: "o3", prompt: "Think hard" },
      async () => ({
        completion: "Answer",
        inputTokens: 100,
        outputTokens: 50,
        thinkingTokens: 200,
      }),
    );

    const spans = exporter.getFinishedSpans();
    const span = spans.find((s) => s.name.includes("o3"));
    expect(span).toBeDefined();
    expect(span!.attributes["gen_ai.usage.reasoning_tokens"]).toBe(200);
    expect(span!.attributes["gen_ai.toad_eye.thinking.ratio"]).toBe(0.8); // 200/(50+200)
    expect(recordThinkingRatio).toHaveBeenCalledWith(0.8, "openai", "o3");
  });

  it("records thinking content as span event", async () => {
    await traceLLMCall(
      {
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
        prompt: "Think",
      },
      async () => ({
        completion: "Result",
        inputTokens: 50,
        outputTokens: 30,
        thinkingContent: "Let me reason step by step...",
      }),
    );

    const spans = exporter.getFinishedSpans();
    const span = spans.find((s) => s.name.includes("claude"));
    expect(span).toBeDefined();
    expect(span!.attributes["gen_ai.toad_eye.thinking.content_length"]).toBe(
      "Let me reason step by step...".length,
    );

    const events = span!.events;
    const thinkingEvent = events.find((e) => e.name === "gen_ai.thinking");
    expect(thinkingEvent).toBeDefined();
    expect(thinkingEvent!.attributes!["gen_ai.toad_eye.thinking.content"]).toBe(
      "Let me reason step by step...",
    );
  });

  it("respects recordContent: false for thinking content", async () => {
    vi.mocked(getConfig).mockReturnValue({
      serviceName: "test",
      recordContent: false,
    });

    await traceLLMCall(
      { provider: "openai", model: "o3", prompt: "Think" },
      async () => ({
        completion: "Result",
        inputTokens: 50,
        outputTokens: 30,
        thinkingContent: "Secret reasoning",
      }),
    );

    const spans = exporter.getFinishedSpans();
    const span = spans.find((s) => s.name.includes("o3"));
    expect(span).toBeDefined();
    // Content length always recorded
    expect(span!.attributes["gen_ai.toad_eye.thinking.content_length"]).toBe(
      16,
    );
    // But no thinking event (content not recorded)
    const thinkingEvent = span!.events.find(
      (e) => e.name === "gen_ai.thinking",
    );
    expect(thinkingEvent).toBeUndefined();
  });

  it("does not record thinking attrs when thinkingTokens is 0", async () => {
    await traceLLMCall(
      { provider: "openai", model: "gpt-4o", prompt: "No thinking" },
      async () => ({
        completion: "Quick answer",
        inputTokens: 50,
        outputTokens: 20,
        thinkingTokens: 0,
      }),
    );

    const spans = exporter.getFinishedSpans();
    const span = spans.find((s) => s.name.includes("gpt-4o"));
    expect(span!.attributes["gen_ai.usage.reasoning_tokens"]).toBeUndefined();
    expect(recordThinkingRatio).not.toHaveBeenCalled();
  });
});
