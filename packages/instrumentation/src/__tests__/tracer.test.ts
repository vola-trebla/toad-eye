import { describe, it, expect, vi, afterEach } from "vitest";

// Mock OTel SDK to avoid real initialization
vi.mock("@opentelemetry/sdk-node", () => ({
  NodeSDK: class {
    start() {}
    shutdown() {}
  },
}));
vi.mock("@opentelemetry/resources", () => ({
  resourceFromAttributes: vi.fn(),
}));
vi.mock("@opentelemetry/exporter-trace-otlp-http", () => ({
  OTLPTraceExporter: vi.fn(),
}));
vi.mock("@opentelemetry/exporter-metrics-otlp-http", () => ({
  OTLPMetricExporter: vi.fn(),
}));
vi.mock("@opentelemetry/sdk-metrics", () => ({
  PeriodicExportingMetricReader: vi.fn(),
}));
vi.mock("@opentelemetry/semantic-conventions", () => ({
  ATTR_SERVICE_NAME: "service.name",
}));
vi.mock("@opentelemetry/api", () => ({
  metrics: { getMeter: () => ({}) },
  diag: { warn: vi.fn(), debug: vi.fn() },
  trace: { getTracer: () => ({}) },
}));
vi.mock("../core/metrics.js", () => ({
  initMetrics: vi.fn(),
  resetMetrics: vi.fn(),
}));
vi.mock("../core/pricing.js", () => ({
  resetCustomPricing: vi.fn(),
  calculateCost: vi.fn(),
  setCustomPricing: vi.fn(),
  getModelPricing: vi.fn(),
}));
vi.mock("../instrumentations/registry.js", () => ({
  enableAll: vi.fn(),
  disableAll: vi.fn(),
}));
vi.mock("../instrumentations/openai.js", () => ({}));
vi.mock("../instrumentations/anthropic.js", () => ({}));
vi.mock("../instrumentations/gemini.js", () => ({}));

const { OTLPTraceExporter } =
  await import("@opentelemetry/exporter-trace-otlp-http");
const { OTLPMetricExporter } =
  await import("@opentelemetry/exporter-metrics-otlp-http");
const { initObservability, shutdown, shouldEmitDeprecatedAttrs } =
  await import("../core/tracer.js");

describe("initObservability — config validation", () => {
  it("throws on empty serviceName", () => {
    expect(() => initObservability({ serviceName: "" })).toThrow(
      "serviceName is required",
    );
  });

  it("throws on whitespace-only serviceName", () => {
    expect(() => initObservability({ serviceName: "   " })).toThrow(
      "serviceName is required",
    );
  });

  it("throws on invalid endpoint", () => {
    expect(() =>
      initObservability({ serviceName: "test", endpoint: "not-a-url" }),
    ).toThrow("endpoint must be a valid URL");
  });

  it("throws on apiKey without toad_ prefix", () => {
    expect(() =>
      initObservability({ serviceName: "test", apiKey: "sk_wrong_prefix" }),
    ).toThrow('apiKey must start with "toad_"');
  });

  it("accepts valid config", async () => {
    // Clean up any previous SDK state
    await shutdown();
    expect(() =>
      initObservability({ serviceName: "test-service" }),
    ).not.toThrow();
    await shutdown();
  });
});

describe("initObservability — cloud mode", () => {
  it("passes auth header to exporters when apiKey is set", async () => {
    await shutdown();

    initObservability({
      serviceName: "cloud-test",
      apiKey: "toad_abc123",
    });

    // OTLPTraceExporter should have been called with cloud endpoint + auth header
    expect(OTLPTraceExporter).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://cloud.toad-eye.dev/v1/traces",
        headers: { Authorization: "Bearer toad_abc123" },
      }),
    );

    expect(OTLPMetricExporter).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://cloud.toad-eye.dev/v1/metrics",
        headers: { Authorization: "Bearer toad_abc123" },
      }),
    );

    await shutdown();
  });

  it("uses custom cloudEndpoint when provided", async () => {
    await shutdown();

    initObservability({
      serviceName: "cloud-custom",
      apiKey: "toad_xyz789",
      cloudEndpoint: "https://my-server.example.com",
    });

    expect(OTLPTraceExporter).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://my-server.example.com/v1/traces",
        headers: { Authorization: "Bearer toad_xyz789" },
      }),
    );

    await shutdown();
  });

  it("uses local endpoint without headers when no apiKey", async () => {
    await shutdown();

    initObservability({
      serviceName: "local-test",
    });

    expect(OTLPTraceExporter).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "http://localhost:4318/v1/traces",
        headers: {},
      }),
    );

    await shutdown();
  });
});

describe("singleton lifecycle", () => {
  it("warns when initObservability is called twice", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await shutdown();

    initObservability({ serviceName: "first" });
    initObservability({ serviceName: "second" });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("already called"),
    );

    warnSpy.mockRestore();
    await shutdown();
  });

  it("calls resetMetrics and resetCustomPricing on shutdown", async () => {
    const { resetMetrics } = await import("../core/metrics.js");
    const { resetCustomPricing } = await import("../core/pricing.js");

    initObservability({ serviceName: "reset-test" });
    await shutdown();

    expect(resetMetrics).toHaveBeenCalled();
    expect(resetCustomPricing).toHaveBeenCalled();
  });
});

describe("shouldEmitDeprecatedAttrs", () => {
  const originalEnv = process.env["OTEL_SEMCONV_STABILITY_OPT_IN"];

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env["OTEL_SEMCONV_STABILITY_OPT_IN"];
    } else {
      process.env["OTEL_SEMCONV_STABILITY_OPT_IN"] = originalEnv;
    }
  });

  it("returns true by default (no env var)", () => {
    delete process.env["OTEL_SEMCONV_STABILITY_OPT_IN"];
    expect(shouldEmitDeprecatedAttrs()).toBe(true);
  });

  it("returns false when set to gen_ai_latest_experimental", () => {
    process.env["OTEL_SEMCONV_STABILITY_OPT_IN"] = "gen_ai_latest_experimental";
    expect(shouldEmitDeprecatedAttrs()).toBe(false);
  });

  it("returns false when gen_ai_latest_experimental is in comma-separated list", () => {
    process.env["OTEL_SEMCONV_STABILITY_OPT_IN"] =
      "http,gen_ai_latest_experimental,database";
    expect(shouldEmitDeprecatedAttrs()).toBe(false);
  });

  it("returns true for unrelated opt-in values", () => {
    process.env["OTEL_SEMCONV_STABILITY_OPT_IN"] = "http,database";
    expect(shouldEmitDeprecatedAttrs()).toBe(true);
  });
});
