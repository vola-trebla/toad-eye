import { describe, it, expect, vi, beforeEach } from "vitest";

// Shared mock span — accessible in tests for assertion
const mockSpan = {
  setAttributes: vi.fn(),
  setStatus: vi.fn(),
  end: vi.fn(),
};

let lastActiveSpanName = "";

// Mock tracer before importing spans
vi.mock("@opentelemetry/api", () => {
  return {
    trace: {
      getTracer: () => ({
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
  recordResponseEmpty: vi.fn(),
  recordResponseLatencyPerToken: vi.fn(),
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
    lastActiveSpanName = "";
  });

  it("uses OTel GenAI span name: chat {model}", async () => {
    await traceLLMCall(
      { provider: "openai", model: "gpt-4o", prompt: "hello" },
      async () => ({
        completion: "world",
        inputTokens: 10,
        outputTokens: 5,
      }),
    );

    expect(lastActiveSpanName).toBe("chat gpt-4o");
  });

  it("warns via console.warn when called without initObservability", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockConfig = undefined as unknown as Record<string, unknown>;

    await traceLLMCall(
      { provider: "openai", model: "gpt-4o", prompt: "hello" },
      async () => ({
        completion: "world",
        inputTokens: 1,
        outputTokens: 1,
        cost: 0,
      }),
    );

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("initObservability"),
    );

    warnSpy.mockRestore();
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

describe("salted hashing (#98)", () => {
  beforeEach(() => {
    mockConfig = {};
    mockSpan.setAttributes.mockClear();
  });

  it("produces different hash with salt vs without", async () => {
    // Without salt
    mockConfig = { hashContent: true };
    await traceLLMCall(
      { provider: "openai", model: "gpt-4o", prompt: "Yes" },
      async () => ({
        completion: "ok",
        inputTokens: 1,
        outputTokens: 1,
        cost: 0,
      }),
    );

    const noSaltCall = mockSpan.setAttributes.mock.calls.find(
      (call: unknown[]) =>
        typeof (call[0] as Record<string, unknown>)[
          "gen_ai.toad_eye.prompt"
        ] === "string",
    );
    const noSaltHash = (noSaltCall![0] as Record<string, string>)[
      "gen_ai.toad_eye.prompt"
    ];

    mockSpan.setAttributes.mockClear();

    // With salt
    mockConfig = { hashContent: true, salt: "my-secret-salt" };
    await traceLLMCall(
      { provider: "openai", model: "gpt-4o", prompt: "Yes" },
      async () => ({
        completion: "ok",
        inputTokens: 1,
        outputTokens: 1,
        cost: 0,
      }),
    );

    const saltCall = mockSpan.setAttributes.mock.calls.find(
      (call: unknown[]) =>
        typeof (call[0] as Record<string, unknown>)[
          "gen_ai.toad_eye.prompt"
        ] === "string",
    );
    const saltHash = (saltCall![0] as Record<string, string>)[
      "gen_ai.toad_eye.prompt"
    ];

    // Both should be sha256 hashes but different values
    expect(noSaltHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(saltHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(noSaltHash).not.toBe(saltHash);
  });
});

describe("privacy — redactDefaults (#129)", () => {
  beforeEach(() => {
    mockConfig = {};
    mockSpan.setAttributes.mockClear();
  });

  it("redacts email with redactDefaults: true", async () => {
    mockConfig = { redactDefaults: true };

    await traceLLMCall(
      {
        provider: "openai",
        model: "gpt-4o",
        prompt: "Contact john@example.com for help",
      },
      async () => ({
        completion: "ok",
        inputTokens: 10,
        outputTokens: 2,
        cost: 0,
      }),
    );

    const call = mockSpan.setAttributes.mock.calls.find(
      (c: unknown[]) =>
        (c[0] as Record<string, unknown>)["gen_ai.toad_eye.prompt"] !==
        undefined,
    );
    const prompt = (call![0] as Record<string, string>)[
      "gen_ai.toad_eye.prompt"
    ];
    expect(prompt).toBe("Contact [REDACTED] for help");
    expect(prompt).not.toContain("john@example.com");
  });

  it("redacts SSN with redactDefaults: true", async () => {
    mockConfig = { redactDefaults: true };

    await traceLLMCall(
      {
        provider: "openai",
        model: "gpt-4o",
        prompt: "SSN is 123-45-6789",
      },
      async () => ({
        completion: "ok",
        inputTokens: 5,
        outputTokens: 1,
        cost: 0,
      }),
    );

    const call = mockSpan.setAttributes.mock.calls.find(
      (c: unknown[]) =>
        (c[0] as Record<string, unknown>)["gen_ai.toad_eye.prompt"] !==
        undefined,
    );
    const prompt = (call![0] as Record<string, string>)[
      "gen_ai.toad_eye.prompt"
    ];
    expect(prompt).toContain("[REDACTED]");
    expect(prompt).not.toContain("123-45-6789");
  });

  it("does not redact when redactDefaults is not set", async () => {
    mockConfig = {};

    await traceLLMCall(
      {
        provider: "openai",
        model: "gpt-4o",
        prompt: "Email: test@example.com",
      },
      async () => ({
        completion: "ok",
        inputTokens: 5,
        outputTokens: 1,
        cost: 0,
      }),
    );

    const call = mockSpan.setAttributes.mock.calls.find(
      (c: unknown[]) =>
        (c[0] as Record<string, unknown>)["gen_ai.toad_eye.prompt"] !==
        undefined,
    );
    const prompt = (call![0] as Record<string, string>)[
      "gen_ai.toad_eye.prompt"
    ];
    expect(prompt).toContain("test@example.com");
  });

  it("audit mode logs a summary without exposing original PII", async () => {
    mockConfig = { redactDefaults: true, auditMasking: true };
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await traceLLMCall(
      {
        provider: "openai",
        model: "gpt-4o",
        prompt: "User email: admin@corp.com",
      },
      async () => ({
        completion: "ok",
        inputTokens: 5,
        outputTokens: 1,
        cost: 0,
      }),
    );

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("[toad-eye audit]"),
    );
    // Must NOT log the original PII
    const loggedMessage = logSpy.mock.calls[0]?.[0] as string;
    expect(loggedMessage).not.toContain("admin@corp.com");
    expect(loggedMessage).toContain("pattern(s) applied");
    logSpy.mockRestore();
  });

  it("redacted prompt is NOT present in span attributes (negative test)", async () => {
    mockConfig = { redactDefaults: true };

    await traceLLMCall(
      {
        provider: "openai",
        model: "gpt-4o",
        prompt: "SSN: 123-45-6789 and card 4111-1111-1111-1111",
      },
      async () => ({
        completion: "ok",
        inputTokens: 10,
        outputTokens: 1,
        cost: 0,
      }),
    );

    const allAttrs = mockSpan.setAttributes.mock.calls.flatMap(
      (call: unknown[]) => Object.values(call[0] as Record<string, unknown>),
    );
    expect(allAttrs).not.toContain("123-45-6789");
    expect(allAttrs).not.toContain("4111-1111-1111-1111");
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
