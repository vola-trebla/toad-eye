import { describe, it, expect, vi } from "vitest";

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
vi.mock("../core/metrics.js", () => ({ initMetrics: vi.fn() }));
vi.mock("../instrumentations/registry.js", () => ({
  enableAll: vi.fn(),
  disableAll: vi.fn(),
}));
vi.mock("../instrumentations/openai.js", () => ({}));
vi.mock("../instrumentations/anthropic.js", () => ({}));
vi.mock("../instrumentations/gemini.js", () => ({}));

const { initObservability, shutdown } = await import("../core/tracer.js");

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

  it("accepts valid config", async () => {
    // Clean up any previous SDK state
    await shutdown();
    expect(() =>
      initObservability({ serviceName: "test-service" }),
    ).not.toThrow();
    await shutdown();
  });
});
