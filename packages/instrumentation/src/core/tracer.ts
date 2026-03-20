import { NodeSDK } from "@opentelemetry/sdk-node";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import type { ToadEyeConfig } from "../types/index.js";
import { initMetrics } from "./metrics.js";
import { enableAll, disableAll } from "../instrumentations/registry.js";
import { BudgetTracker } from "../budget/index.js";

// Side-effect imports: register provider instrumentations
import "../instrumentations/openai.js";
import "../instrumentations/anthropic.js";
import "../instrumentations/gemini.js";

const DEFAULT_ENDPOINT = "http://localhost:4318";
const DEFAULT_CLOUD_ENDPOINT = "https://cloud.toad-eye.dev";

let sdk: NodeSDK | null = null;
let currentConfig: ToadEyeConfig | null = null;
let budgetTracker: BudgetTracker | null = null;

export function getConfig() {
  return currentConfig;
}

export function getBudgetTracker() {
  return budgetTracker;
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
  if (config.apiKey !== undefined && !config.apiKey.startsWith("toad_")) {
    throw new Error('toad-eye: apiKey must start with "toad_" prefix');
  }
}

/** Resolve endpoint and auth headers based on config mode (self-hosted vs cloud). */
function resolveTransport(config: ToadEyeConfig) {
  const isCloudMode = config.apiKey !== undefined;

  const endpoint = isCloudMode
    ? (config.cloudEndpoint ?? DEFAULT_CLOUD_ENDPOINT)
    : (config.endpoint ?? DEFAULT_ENDPOINT);

  const headers: Record<string, string> = isCloudMode
    ? { Authorization: `Bearer ${config.apiKey}` }
    : {};

  return { endpoint, headers, isCloudMode };
}

export function initObservability(config: ToadEyeConfig) {
  if (sdk) return;

  validateConfig(config);
  const { endpoint, headers, isCloudMode } = resolveTransport(config);

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: config.serviceName,
  });

  const traceExporter = new OTLPTraceExporter({
    url: `${endpoint}/v1/traces`,
    headers,
  });

  const metricExporter = new OTLPMetricExporter({
    url: `${endpoint}/v1/metrics`,
    headers,
  });

  const metricReader = new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: isCloudMode ? 10_000 : 5_000,
  });

  sdk = new NodeSDK({
    resource,
    traceExporter,
    metricReader,
  });

  sdk.start();
  currentConfig = config;
  initMetrics();

  if (isCloudMode) {
    console.log(
      `toad-eye: cloud mode enabled → sending telemetry to ${endpoint}`,
    );
  }

  if (config.budgets) {
    budgetTracker = new BudgetTracker(
      config.budgets,
      config.onBudgetExceeded ?? "warn",
      config.downgradeCallback,
    );
  }

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
  budgetTracker = null;
}
