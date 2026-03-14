import { NodeSDK } from "@opentelemetry/sdk-node";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import type { ToadEyeConfig } from "./types.js";
import { initMetrics } from "./metrics.js";

const DEFAULT_ENDPOINT = "http://localhost:4318";

let sdk: NodeSDK | null = null;

export function initObservability(config: ToadEyeConfig) {
  if (sdk) return;

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
  initMetrics();
}

export function shutdown() {
  if (!sdk) return;
  sdk.shutdown();
  sdk = null;
}
