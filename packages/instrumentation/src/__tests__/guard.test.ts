import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSpan = {
  setAttributes: vi.fn(),
  end: vi.fn(),
};

vi.mock("@opentelemetry/api", () => ({
  trace: {
    getTracer: () => ({
      startSpan: (_name: string) => mockSpan,
    }),
  },
  metrics: { getMeter: () => ({}) },
  diag: { warn: vi.fn(), debug: vi.fn() },
}));

const mockRecordGuardEvaluation = vi.fn();
const mockRecordGuardWouldBlock = vi.fn();

vi.mock("../core/metrics.js", () => ({
  recordGuardEvaluation: (...args: unknown[]) =>
    mockRecordGuardEvaluation(...args),
  recordGuardWouldBlock: (...args: unknown[]) =>
    mockRecordGuardWouldBlock(...args),
}));

const { recordGuardResult } = await import("../guard.js");

describe("recordGuardResult", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a span with guard attributes for passing result", () => {
    recordGuardResult({
      mode: "shadow",
      passed: true,
      ruleName: "schema_check",
    });

    expect(mockSpan.setAttributes).toHaveBeenCalledWith({
      "gen_ai.toad_eye.guard.mode": "shadow",
      "gen_ai.toad_eye.guard.passed": true,
      "gen_ai.toad_eye.guard.rule_name": "schema_check",
    });
    expect(mockSpan.end).toHaveBeenCalled();
  });

  it("includes failure_reason when guard fails", () => {
    recordGuardResult({
      mode: "shadow",
      passed: false,
      ruleName: "json_format",
      failureReason: "Invalid JSON in response",
    });

    expect(mockSpan.setAttributes).toHaveBeenCalledWith({
      "gen_ai.toad_eye.guard.mode": "shadow",
      "gen_ai.toad_eye.guard.passed": false,
      "gen_ai.toad_eye.guard.rule_name": "json_format",
      "gen_ai.toad_eye.guard.failure_reason": "Invalid JSON in response",
    });
  });

  it("omits failure_reason when guard passes", () => {
    recordGuardResult({
      mode: "enforce",
      passed: true,
      ruleName: "toxicity",
    });

    const attrs = mockSpan.setAttributes.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(attrs).not.toHaveProperty("gen_ai.toad_eye.guard.failure_reason");
  });

  it("records evaluation metric for every result", () => {
    recordGuardResult({
      mode: "shadow",
      passed: true,
      ruleName: "length_check",
    });

    expect(mockRecordGuardEvaluation).toHaveBeenCalledWith("length_check");
  });

  it("records would_block metric only when guard fails", () => {
    recordGuardResult({
      mode: "shadow",
      passed: false,
      ruleName: "pii_filter",
      failureReason: "SSN detected",
    });

    expect(mockRecordGuardWouldBlock).toHaveBeenCalledWith("pii_filter");
  });

  it("does not record would_block when guard passes", () => {
    recordGuardResult({
      mode: "shadow",
      passed: true,
      ruleName: "pii_filter",
    });

    expect(mockRecordGuardWouldBlock).not.toHaveBeenCalled();
  });

  it("works with enforce mode", () => {
    recordGuardResult({
      mode: "enforce",
      passed: false,
      ruleName: "content_policy",
      failureReason: "Blocked content",
    });

    expect(mockSpan.setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        "gen_ai.toad_eye.guard.mode": "enforce",
      }),
    );
    expect(mockRecordGuardEvaluation).toHaveBeenCalledWith("content_policy");
    expect(mockRecordGuardWouldBlock).toHaveBeenCalledWith("content_policy");
  });
});
