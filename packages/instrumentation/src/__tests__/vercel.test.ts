import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock metrics
const mockRecordRequest = vi.fn();
const mockRecordRequestDuration = vi.fn();
const mockRecordRequestCost = vi.fn();
const mockRecordTokens = vi.fn();

vi.mock("../core/metrics.js", () => ({
  recordRequest: (...args: unknown[]) => mockRecordRequest(...args),
  recordRequestDuration: (...args: unknown[]) =>
    mockRecordRequestDuration(...args),
  recordRequestCost: (...args: unknown[]) => mockRecordRequestCost(...args),
  recordTokens: (...args: unknown[]) => mockRecordTokens(...args),
  initMetrics: vi.fn(),
}));

vi.mock("@opentelemetry/api", () => ({
  metrics: { getMeter: () => ({}) },
  diag: { warn: vi.fn(), debug: vi.fn() },
}));

const { ToadEyeAISpanProcessor, withToadEye } = await import("../vercel.js");

function makeSpan(attrs: Record<string, unknown>) {
  return {
    name: attrs["ai.operationId"] ?? "ai.generateText",
    attributes: attrs,
    startTime: [1000, 0] as [number, number],
    endTime: [1000, 500_000_000] as [number, number], // 500ms
  };
}

describe("ToadEyeAISpanProcessor", () => {
  let processor: InstanceType<typeof ToadEyeAISpanProcessor>;

  beforeEach(() => {
    processor = new ToadEyeAISpanProcessor();
    mockRecordRequest.mockClear();
    mockRecordRequestDuration.mockClear();
    mockRecordRequestCost.mockClear();
    mockRecordTokens.mockClear();
  });

  it("records metrics for ai.generateText spans", () => {
    const span = makeSpan({
      "ai.operationId": "ai.generateText",
      "gen_ai.request.model": "gpt-4o",
      "gen_ai.system": "openai",
      "gen_ai.usage.input_tokens": 100,
      "gen_ai.usage.output_tokens": 50,
    });

    processor.onEnd(span as never);

    expect(mockRecordRequest).toHaveBeenCalledWith("openai", "gpt-4o");
    expect(mockRecordRequestDuration).toHaveBeenCalledWith(
      500,
      "openai",
      "gpt-4o",
    );
    expect(mockRecordTokens).toHaveBeenCalledWith(150, "openai", "gpt-4o");
    expect(mockRecordRequestCost).toHaveBeenCalledOnce();
  });

  it("records metrics for ai.streamText spans", () => {
    const span = makeSpan({
      "ai.operationId": "ai.streamText",
      "gen_ai.request.model": "claude-sonnet-4-20250514",
      "gen_ai.system": "anthropic",
      "gen_ai.usage.input_tokens": 200,
      "gen_ai.usage.output_tokens": 100,
    });

    processor.onEnd(span as never);

    expect(mockRecordRequest).toHaveBeenCalledWith(
      "anthropic",
      "claude-sonnet-4-20250514",
    );
    expect(mockRecordTokens).toHaveBeenCalledWith(
      300,
      "anthropic",
      "claude-sonnet-4-20250514",
    );
  });

  it("falls back to ai.model.id when gen_ai attributes missing", () => {
    const span = makeSpan({
      "ai.operationId": "ai.generateText",
      "ai.model.id": "gemini-2.0-flash",
      "ai.model.provider": "google.generative-ai",
      "ai.usage.promptTokens": 50,
      "ai.usage.completionTokens": 25,
    });

    processor.onEnd(span as never);

    expect(mockRecordRequest).toHaveBeenCalledWith(
      "google",
      "gemini-2.0-flash",
    );
    expect(mockRecordTokens).toHaveBeenCalledWith(
      75,
      "google",
      "gemini-2.0-flash",
    );
  });

  it("ignores non-AI SDK spans", () => {
    const span = makeSpan({
      "ai.operationId": "some.other.operation",
      "gen_ai.request.model": "gpt-4o",
    });

    processor.onEnd(span as never);

    expect(mockRecordRequest).not.toHaveBeenCalled();
  });

  it("skips cost recording when model not in pricing table", () => {
    const span = makeSpan({
      "ai.operationId": "ai.generateText",
      "gen_ai.request.model": "unknown-model-xyz",
      "gen_ai.system": "custom",
      "gen_ai.usage.input_tokens": 10,
      "gen_ai.usage.output_tokens": 5,
    });

    processor.onEnd(span as never);

    expect(mockRecordRequest).toHaveBeenCalled();
    expect(mockRecordRequestCost).not.toHaveBeenCalled(); // cost = 0 for unknown
  });

  it("handles generateObject spans", () => {
    const span = makeSpan({
      "ai.operationId": "ai.generateObject",
      "gen_ai.request.model": "gpt-4o",
      "gen_ai.system": "openai",
      "gen_ai.usage.input_tokens": 300,
      "gen_ai.usage.output_tokens": 200,
    });

    processor.onEnd(span as never);

    expect(mockRecordRequest).toHaveBeenCalledWith("openai", "gpt-4o");
  });
});

describe("withToadEye helper", () => {
  it("returns isEnabled: true by default", () => {
    const result = withToadEye();
    expect(result.isEnabled).toBe(true);
  });

  it("passes through functionId", () => {
    const result = withToadEye({ functionId: "my-feature" });
    expect(result.isEnabled).toBe(true);
    expect(result.functionId).toBe("my-feature");
  });

  it("passes through metadata", () => {
    const result = withToadEye({
      metadata: { userId: "user-123", team: "checkout" },
    });
    expect(result.metadata).toEqual({
      userId: "user-123",
      team: "checkout",
    });
  });
});
