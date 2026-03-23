/**
 * MCP-specific OTel metrics.
 *
 * Separate from core metrics (core/metrics.ts) — these only exist
 * when MCP middleware is active. Initialized on first middleware call.
 */

import {
  metrics,
  type Counter,
  type Histogram,
  type UpDownCounter,
} from "@opentelemetry/api";
import { GEN_AI_METRICS } from "../types/metrics.js";

const METER_NAME = "toad-eye-mcp";

let toolDuration: Histogram;
let toolCalls: Counter;
let toolErrors: Counter;
let resourceReads: Counter;
let sessionActive: UpDownCounter;

let initialized = false;

function ensureInit() {
  if (initialized) return;
  initialized = true;

  const meter = metrics.getMeter(METER_NAME);

  toolDuration = meter.createHistogram(GEN_AI_METRICS.MCP_TOOL_DURATION, {
    description: "MCP tool execution duration",
    unit: "ms",
  });

  toolCalls = meter.createCounter(GEN_AI_METRICS.MCP_TOOL_CALLS, {
    description: "MCP tool call count by tool name and status",
  });

  toolErrors = meter.createCounter(GEN_AI_METRICS.MCP_TOOL_ERRORS, {
    description: "MCP tool errors by tool name and error type",
  });

  resourceReads = meter.createCounter(GEN_AI_METRICS.MCP_RESOURCE_READS, {
    description: "MCP resource read count by URI",
  });

  sessionActive = meter.createUpDownCounter(GEN_AI_METRICS.MCP_SESSION_ACTIVE, {
    description: "Number of active MCP sessions",
  });
}

export function recordMcpToolCall(
  toolName: string,
  durationMs: number,
  status: "success" | "error",
) {
  ensureInit();
  toolCalls.add(1, { "gen_ai.tool.name": toolName, status });
  toolDuration.record(durationMs, { "gen_ai.tool.name": toolName });
}

export function recordMcpToolError(toolName: string, errorType: string) {
  ensureInit();
  toolErrors.add(1, { "gen_ai.tool.name": toolName, "error.type": errorType });
}

export function recordMcpResourceRead(uri: string) {
  ensureInit();
  resourceReads.add(1, { "gen_ai.data_source.id": uri });
}

export function recordMcpSessionStart() {
  ensureInit();
  sessionActive.add(1);
}

export function recordMcpSessionEnd() {
  ensureInit();
  sessionActive.add(-1);
}
