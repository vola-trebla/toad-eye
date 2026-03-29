/**
 * MCP-specific OTel metrics.
 *
 * Separate from core metrics (core/metrics.ts) — these only exist
 * when MCP middleware is active. Initialized on first middleware call.
 *
 * All metrics include `mcp.method.name` dimension per OTel MCP semconv.
 */

import {
  metrics,
  type Counter,
  type Histogram,
  type UpDownCounter,
} from "@opentelemetry/api";
import { GEN_AI_METRICS } from "../types/metrics.js";
import { MCP_METHODS } from "./spans.js";

const METER_NAME = "toad-eye-mcp";

let toolDuration: Histogram;
let toolCalls: Counter;
let toolErrors: Counter;
let toolHallucinations: Counter;
let resourceReads: Counter;
let sessionActive: UpDownCounter;
let toolCallers: Counter;

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

  toolHallucinations = meter.createCounter(
    GEN_AI_METRICS.MCP_TOOL_HALLUCINATIONS,
    {
      description: "Agent tried to call a non-existent tool (JSON-RPC -32601)",
    },
  );

  resourceReads = meter.createCounter(GEN_AI_METRICS.MCP_RESOURCE_READS, {
    description: "MCP resource read count by URI",
  });

  sessionActive = meter.createUpDownCounter(GEN_AI_METRICS.MCP_SESSION_ACTIVE, {
    description: "Number of active MCP sessions",
  });

  toolCallers = meter.createCounter(GEN_AI_METRICS.MCP_TOOL_CALLERS, {
    description:
      "MCP tool calls by session — use count(distinct) for unique callers",
  });
}

export function recordMcpToolCall(
  toolName: string,
  durationMs: number,
  status: "success" | "error",
  sessionId?: string,
) {
  ensureInit();
  toolCalls.add(1, {
    "gen_ai.tool.name": toolName,
    "mcp.method.name": MCP_METHODS.TOOLS_CALL,
    status,
  });
  toolDuration.record(durationMs, {
    "gen_ai.tool.name": toolName,
    "mcp.method.name": MCP_METHODS.TOOLS_CALL,
  });
  if (sessionId) {
    toolCallers.add(1, {
      "gen_ai.tool.name": toolName,
      "mcp.session.id": sessionId,
    });
  }
}

export function recordMcpToolError(toolName: string, errorType: string) {
  ensureInit();
  toolErrors.add(1, {
    "gen_ai.tool.name": toolName,
    "mcp.method.name": MCP_METHODS.TOOLS_CALL,
    "error.type": errorType,
  });
}

export function recordMcpResourceRead(uri: string) {
  ensureInit();
  resourceReads.add(1, {
    "gen_ai.data_source.id": uri,
    "mcp.method.name": MCP_METHODS.RESOURCES_READ,
  });
}

export function recordMcpSessionStart() {
  ensureInit();
  sessionActive.add(1);
}

export function recordMcpToolHallucination(toolName: string) {
  ensureInit();
  toolHallucinations.add(1, {
    "gen_ai.tool.name": toolName,
    "mcp.method.name": MCP_METHODS.TOOLS_CALL,
  });
}

export function recordMcpSessionEnd() {
  ensureInit();
  sessionActive.add(-1);
}

/** Reset MCP metrics state — must be called from shutdown() alongside resetMetrics(). */
export function resetMcpMetrics() {
  initialized = false;
}
