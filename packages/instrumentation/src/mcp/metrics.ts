/**
 * MCP-specific OTel metrics.
 *
 * Separate from core metrics (core/metrics.ts) — these only exist
 * when MCP middleware is active. Initialized on first middleware call.
 */

import { metrics, type Counter, type Histogram } from "@opentelemetry/api";

const METER_NAME = "toad-eye-mcp";

let toolDuration: Histogram;
let toolCalls: Counter;
let toolErrors: Counter;
let resourceReads: Counter;

let initialized = false;

function ensureInit() {
  if (initialized) return;
  initialized = true;

  const meter = metrics.getMeter(METER_NAME);

  toolDuration = meter.createHistogram("gen_ai.mcp.tool.duration", {
    description: "MCP tool execution duration",
    unit: "ms",
  });

  toolCalls = meter.createCounter("gen_ai.mcp.tool.calls", {
    description: "MCP tool call count by tool name and status",
  });

  toolErrors = meter.createCounter("gen_ai.mcp.tool.errors", {
    description: "MCP tool errors by tool name and error type",
  });

  resourceReads = meter.createCounter("gen_ai.mcp.resource.reads", {
    description: "MCP resource read count by URI",
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
