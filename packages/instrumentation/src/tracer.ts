import { NodeSDK } from "@opentelemetry/sdk-node";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import type { ToadEyeConfig } from "./types/index.js";
import { initMetrics } from "./metrics.js";
import { enableAll, disableAll } from "./instrumentations/registry.js";

// Side-effect imports: register provider instrumentations
import "./instrumentations/openai.js";
import "./instrumentations/anthropic.js";
import "./instrumentations/gemini.js";

const DEFAULT_ENDPOINT = "http://localhost:4318";

let sdk: NodeSDK | null = null;
let currentConfig: ToadEyeConfig | null = null;

export function getConfig() {
  return currentConfig;
}

function validateConfig(config: ToadEyeConfig) {
  if (!config.serviceName?.trim()) {
    throw new Error("toad-eye: serviceName is required and cannot be empty");
  }
  if (config.endpoint !== undefined && !config.endpoint.startsWith("http")) {
    throw new Error(
      `toad-eye: endpoint must be a valid URL, got "${config.endpoint}"`,
    );
  }
}

export function initObservability(config: ToadEyeConfig) {
  if (sdk) return;

  validateConfig(config);
  const endpoint = config.endpoint ?? DEFAULT_ENDPOINT;

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: config.serviceName,
  });

  const traceExporter = new OTLPTraceExporter({
    url: `${endpoint}/v1/traces`,
  });

  const metricExporter = new OTLPMetricExporter({
    url: `${endpoint}/v1/metrics`,
  });

  const metricReader = new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: 5000,
  });

  sdk = new NodeSDK({
    resource,
    traceExporter,
    metricReader,
  });

  sdk.start();
  currentConfig = config;
  initMetrics();

  if (config.instrument?.length) {
    enableAll(config.instrument);
  }
}

export async function shutdown() {
  if (!sdk) return;
  disableAll();
  await sdk.shutdown();
  sdk = null;
  currentConfig = null;
}
