import { NodeSDK } from "@opentelemetry/sdk-node";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import {
  TraceIdRatioBasedSampler,
  ParentBasedSampler,
  BatchSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import type { ToadEyeConfig } from "../types/index.js";
import { initMetrics, resetMetrics } from "./metrics.js";
import { resetCustomPricing } from "./pricing.js";
import { enableAll, disableAll } from "../instrumentations/registry.js";
import {
  enableMcpInstrumentation,
  disableMcpInstrumentation,
} from "../instrumentations/mcp.js";
import {
  enableMcpClientInstrumentation,
  disableMcpClientInstrumentation,
} from "../mcp/client.js";
import { resetMcpMetrics } from "../mcp/metrics.js";
import { BudgetTracker } from "../budget/index.js";
import { ToadEyeAISpanProcessor } from "../vercel.js";
import { ToadEyeSpanEndProcessor } from "./span-end-processor.js";
import type { LLMProvider } from "../types/index.js";

const DEFAULT_ENDPOINT = "http://localhost:4318";
const DEFAULT_CLOUD_ENDPOINT = "https://cloud.toad-eye.dev";

let sdk: NodeSDK | null = null;
let currentConfig: ToadEyeConfig | null = null;
let budgetTracker: BudgetTracker | null = null;

export function getConfig() {
  return currentConfig;
}

/**
 * Check if deprecated semconv aliases should be emitted.
 * When OTEL_SEMCONV_STABILITY_OPT_IN includes "gen_ai_latest_experimental",
 * only new (canonical) attributes are emitted — deprecated aliases are skipped.
 */
export function shouldEmitDeprecatedAttrs(): boolean {
  const optIn = process.env["OTEL_SEMCONV_STABILITY_OPT_IN"] ?? "";
  return !optIn.split(",").includes("gen_ai_latest_experimental");
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
  if (
    config.onBudgetExceeded === "downgrade" &&
    config.downgradeCallback === undefined
  ) {
    throw new Error(
      'toad-eye: downgradeCallback is required when onBudgetExceeded is "downgrade"',
    );
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
  if (sdk) {
    console.warn(
      "toad-eye: initObservability() already called. Call shutdown() first to reconfigure.",
    );
    return;
  }

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

  // When custom SpanProcessors are needed (e.g., Vercel AI SDK, onSpanEnd),
  // we must also include a BatchSpanProcessor for trace export —
  // NodeSDK won't create one automatically when spanProcessors is provided.
  const needsCustomProcessors =
    config.instrument?.includes("ai") || config.onSpanEnd !== undefined;

  const spanProcessors = needsCustomProcessors
    ? [
        new BatchSpanProcessor(traceExporter),
        ...(config.instrument?.includes("ai")
          ? [new ToadEyeAISpanProcessor()]
          : []),
        ...(config.onSpanEnd !== undefined
          ? [new ToadEyeSpanEndProcessor(config.onSpanEnd)]
          : []),
      ]
    : [];

  // SDK-side head sampling (default: 1.0 = send everything to Collector)
  const sdkRate = config.sampling?.sdkRate ?? 1.0;
  const sampler =
    sdkRate < 1.0
      ? new ParentBasedSampler({
          root: new TraceIdRatioBasedSampler(sdkRate),
        })
      : undefined;

  sdk = new NodeSDK({
    resource,
    traceExporter,
    metricReader,
    ...(spanProcessors.length > 0 && { spanProcessors }),
    ...(sampler !== undefined && { sampler }),
  });

  sdk.start();
  currentConfig = config;
  initMetrics();

  // Non-blocking connectivity check — warns the user if the OTel Collector is unreachable.
  // Fire-and-forget: does not block initObservability(). Cloud mode skips this check.
  if (!isCloudMode) {
    void fetch(`${endpoint}/v1/traces`, {
      method: "POST",
      body: "[]",
      signal: AbortSignal.timeout(2000),
    }).catch(() => {
      console.warn(
        `toad-eye: cannot reach OTel Collector at ${endpoint} — no telemetry will be exported. Is the stack running? Run: npx toad-eye up`,
      );
    });
  }

  if (isCloudMode) {
    const masked = config.apiKey
      ? config.apiKey.slice(0, 8) + "..." + config.apiKey.slice(-4)
      : "";
    console.log(
      `toad-eye: cloud mode enabled (${masked}) → sending telemetry to ${endpoint}`,
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
    // Handle MCP server auto-instrumentation
    if (config.instrument.includes("mcp")) {
      const patched = enableMcpInstrumentation();
      if (!patched) {
        console.warn(
          `toad-eye: "@modelcontextprotocol/sdk" not found — install it to enable MCP server auto-instrumentation`,
        );
      }
    }

    // Handle MCP client auto-instrumentation
    if (config.instrument.includes("mcp-client")) {
      const patched = enableMcpClientInstrumentation();
      if (!patched) {
        console.warn(
          `toad-eye: "@modelcontextprotocol/sdk" not found — install it to enable MCP client auto-instrumentation`,
        );
      }
    }

    // Filter out special targets — they use separate mechanisms
    const patchProviders = config.instrument.filter(
      (i): i is LLMProvider => i !== "ai" && i !== "mcp" && i !== "mcp-client",
    );
    if (patchProviders.length > 0) {
      // enableAll is async (lazy-loads provider modules on first call).
      // Fire-and-forget: patching completes before any async SDK call.
      void enableAll(patchProviders).catch((err) => {
        console.warn(
          `toad-eye: auto-instrumentation failed: ${err instanceof Error ? err.message : err}`,
        );
      });
    }
  }
}

export async function shutdown() {
  if (!sdk) return;
  disableAll();
  disableMcpInstrumentation();
  disableMcpClientInstrumentation();
  await sdk.shutdown();
  sdk = null;
  currentConfig = null;
  budgetTracker = null;
  resetMetrics();
  resetMcpMetrics();
  resetCustomPricing();
}
