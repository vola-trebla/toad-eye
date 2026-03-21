import { describe, it, expect, vi, beforeEach } from "vitest";
import { parse } from "yaml";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const { fetchTrace, traceToEvalYaml, exportTrace } =
  await import("../export.js");

// -- Helpers --

function makeTag(key: string, value: string | number | boolean) {
  return { key, type: typeof value === "string" ? "string" : "int64", value };
}

function makeSpan(
  tags: ReturnType<typeof makeTag>[],
  overrides: Record<string, unknown> = {},
) {
  return {
    traceID: "abc123def456",
    spanID: "span001",
    operationName: "gen_ai.openai.gpt-4o",
    tags,
    startTime: 1710000000000,
    duration: 1200000,
    ...overrides,
  };
}

function makeTrace(spans: ReturnType<typeof makeSpan>[]) {
  return { traceID: "abc123def456", spans };
}

function jaegerResponse(traces: ReturnType<typeof makeTrace>[]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ data: traces }),
  };
}

// -- Tests --

describe("fetchTrace", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("fetches trace from Jaeger API", async () => {
    const trace = makeTrace([makeSpan([])]);
    mockFetch.mockResolvedValue(jaegerResponse([trace]));

    const result = await fetchTrace("abc123");

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:16686/api/traces/abc123",
    );
    expect(result.traceID).toBe("abc123def456");
  });

  it("uses custom jaeger URL", async () => {
    const trace = makeTrace([makeSpan([])]);
    mockFetch.mockResolvedValue(jaegerResponse([trace]));

    await fetchTrace("abc123", "http://jaeger:9999");

    expect(mockFetch).toHaveBeenCalledWith(
      "http://jaeger:9999/api/traces/abc123",
    );
  });

  it("throws on HTTP error", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
    });

    await expect(fetchTrace("bad-id")).rejects.toThrow(
      "Failed to fetch trace bad-id: 404 Not Found",
    );
  });

  it("throws when trace not found in response", async () => {
    mockFetch.mockResolvedValue(jaegerResponse([]));

    await expect(fetchTrace("missing")).rejects.toThrow(
      "Trace missing not found",
    );
  });
});

describe("traceToEvalYaml", () => {
  it("converts a trace with prompt and completion to YAML", () => {
    const trace = makeTrace([
      makeSpan([
        makeTag("gen_ai.toad_eye.prompt", "What is 2+2?"),
        makeTag("gen_ai.toad_eye.completion", "4"),
        makeTag("gen_ai.request.model", "gpt-4o"),
        makeTag("gen_ai.provider.name", "openai"),
      ]),
    ]);

    const yaml = traceToEvalYaml(trace);
    expect(yaml).toBeDefined();

    const parsed = parse(yaml!) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      name: "exported-trace-abc123de",
      source: "toad-eye-export",
      metadata: expect.objectContaining({
        trace_id: "abc123def456",
        model: "gpt-4o",
        provider: "openai",
      }),
    });

    const cases = parsed.cases as Array<Record<string, unknown>>;
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({
      id: "production-case-1",
      variables: { input: "What is 2+2?" },
    });
  });

  it("generates max_length assertion from completion", () => {
    const trace = makeTrace([
      makeSpan([
        makeTag("gen_ai.toad_eye.prompt", "hello"),
        makeTag("gen_ai.toad_eye.completion", "world"), // length 5 → ceil(5*1.5) = 8
      ]),
    ]);

    const parsed = parse(traceToEvalYaml(trace)!) as Record<string, unknown>;
    const assertions = (
      parsed.cases as Array<{
        assertions: Array<{ type: string; value: unknown }>;
      }>
    )[0]!.assertions;

    expect(assertions).toContainEqual({ type: "max_length", value: 8 });
  });

  it("generates not_contains assertion when response is not a refusal", () => {
    const trace = makeTrace([
      makeSpan([
        makeTag("gen_ai.toad_eye.prompt", "hello"),
        makeTag("gen_ai.toad_eye.completion", "Hi there!"),
      ]),
    ]);

    const parsed = parse(traceToEvalYaml(trace)!) as Record<string, unknown>;
    const assertions = (
      parsed.cases as Array<{
        assertions: Array<{ type: string; value: unknown }>;
      }>
    )[0]!.assertions;

    expect(assertions).toContainEqual({
      type: "not_contains",
      value: "i cannot",
    });
  });

  it("skips not_contains for refusal responses", () => {
    const trace = makeTrace([
      makeSpan([
        makeTag("gen_ai.toad_eye.prompt", "do something bad"),
        makeTag("gen_ai.toad_eye.completion", "I cannot do that"),
      ]),
    ]);

    const parsed = parse(traceToEvalYaml(trace)!) as Record<string, unknown>;
    const assertions = (
      parsed.cases as Array<{
        assertions: Array<{ type: string; value: unknown }>;
      }>
    )[0]!.assertions;

    expect(assertions).not.toContainEqual(
      expect.objectContaining({ type: "not_contains" }),
    );
  });

  it("generates is_json assertion for JSON completions", () => {
    const trace = makeTrace([
      makeSpan([
        makeTag("gen_ai.toad_eye.prompt", "give me json"),
        makeTag("gen_ai.toad_eye.completion", '{"answer": 42}'),
      ]),
    ]);

    const parsed = parse(traceToEvalYaml(trace)!) as Record<string, unknown>;
    const assertions = (
      parsed.cases as Array<{
        assertions: Array<{ type: string; value: unknown }>;
      }>
    )[0]!.assertions;

    expect(assertions).toContainEqual({ type: "is_json", value: true });
  });

  it("returns undefined when no spans have prompt data", () => {
    const trace = makeTrace([
      makeSpan([makeTag("gen_ai.request.model", "gpt-4o")]),
    ]);

    expect(traceToEvalYaml(trace)).toBeUndefined();
  });

  it("handles multiple spans — only exports those with prompts", () => {
    const trace = makeTrace([
      makeSpan([makeTag("gen_ai.request.model", "gpt-4o")]), // no prompt
      makeSpan([
        makeTag("gen_ai.toad_eye.prompt", "first"),
        makeTag("gen_ai.toad_eye.completion", "one"),
      ]),
      makeSpan([
        makeTag("gen_ai.toad_eye.prompt", "second"),
        makeTag("gen_ai.toad_eye.completion", "two"),
      ]),
    ]);

    const parsed = parse(traceToEvalYaml(trace)!) as Record<string, unknown>;
    const cases = parsed.cases as Array<Record<string, unknown>>;
    expect(cases).toHaveLength(2);
    expect(cases[0]!.id).toBe("production-case-2");
    expect(cases[1]!.id).toBe("production-case-3");
  });
});

describe("exportTrace", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("returns YAML string for valid trace", async () => {
    const trace = makeTrace([
      makeSpan([
        makeTag("gen_ai.toad_eye.prompt", "test"),
        makeTag("gen_ai.toad_eye.completion", "result"),
        makeTag("gen_ai.request.model", "gpt-4o"),
        makeTag("gen_ai.provider.name", "openai"),
      ]),
    ]);
    mockFetch.mockResolvedValue(jaegerResponse([trace]));

    const yaml = await exportTrace("abc123");
    expect(yaml).toContain("toad-eye-export");
    expect(yaml).toContain("test");
  });

  it("throws when trace has no exportable spans", async () => {
    const trace = makeTrace([makeSpan([])]);
    mockFetch.mockResolvedValue(jaegerResponse([trace]));

    await expect(exportTrace("abc123")).rejects.toThrow(
      "No exportable spans in trace abc123",
    );
  });
});
