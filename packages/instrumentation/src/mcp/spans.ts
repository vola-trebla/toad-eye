/**
 * OTel span creation for MCP operations.
 *
 * Follows OTel MCP semantic conventions (PR #2083):
 * - tools/call              → `tools/call {tool_name}`
 * - resources/read          → `resources/read {uri}`
 * - prompts/get             → `prompts/get {name}`
 * - sampling/createMessage  → `sampling/createMessage {model}`
 */

import {
  trace,
  SpanStatusCode,
  SpanKind,
  type Context,
} from "@opentelemetry/api";

const TRACER_NAME = "toad-eye-mcp";

const tracer = trace.getTracer(TRACER_NAME);

/** MCP method names per OTel semconv. */
export const MCP_METHODS = {
  TOOLS_CALL: "tools/call",
  RESOURCES_READ: "resources/read",
  PROMPTS_GET: "prompts/get",
  SAMPLING_CREATE_MESSAGE: "sampling/createMessage",
} as const;

export interface SpanOptions {
  readonly serverName: string;
  readonly serverVersion: string;
  readonly parentContext: Context;
  readonly sessionId?: string | undefined;
  readonly protocolVersion?: string | undefined;
  readonly networkTransport?: string | undefined;
}

/** Build common MCP attributes shared across all span types. */
function baseAttrs(method: string, options: SpanOptions | SamplingSpanOptions) {
  const attrs: Record<string, string> = {
    "gen_ai.operation.name": method,
    "mcp.method.name": method,
    "mcp.server.name": options.serverName,
    "mcp.server.version": options.serverVersion,
  };
  if (options.sessionId) attrs["mcp.session.id"] = options.sessionId;
  if (options.protocolVersion)
    attrs["mcp.protocol.version"] = options.protocolVersion;
  if (options.networkTransport)
    attrs["network.transport"] = options.networkTransport;
  return attrs;
}

export function startToolSpan(toolName: string, options: SpanOptions) {
  return tracer.startSpan(
    `${MCP_METHODS.TOOLS_CALL} ${toolName}`,
    {
      kind: SpanKind.SERVER,
      attributes: {
        ...baseAttrs(MCP_METHODS.TOOLS_CALL, options),
        "gen_ai.tool.name": toolName,
      },
    },
    options.parentContext,
  );
}

export function startResourceSpan(uri: string, options: SpanOptions) {
  return tracer.startSpan(
    `${MCP_METHODS.RESOURCES_READ} ${uri}`,
    {
      kind: SpanKind.SERVER,
      attributes: {
        ...baseAttrs(MCP_METHODS.RESOURCES_READ, options),
        "gen_ai.data_source.id": uri,
      },
    },
    options.parentContext,
  );
}

export function startPromptSpan(promptName: string, options: SpanOptions) {
  return tracer.startSpan(
    `${MCP_METHODS.PROMPTS_GET} ${promptName}`,
    {
      kind: SpanKind.SERVER,
      attributes: {
        ...baseAttrs(MCP_METHODS.PROMPTS_GET, options),
        "gen_ai.prompt.name": promptName,
      },
    },
    options.parentContext,
  );
}

export interface SamplingSpanOptions {
  readonly serverName: string;
  readonly serverVersion: string;
  readonly parentContext?: Context | undefined;
  readonly sessionId?: string | undefined;
  readonly protocolVersion?: string | undefined;
  readonly networkTransport?: string | undefined;
}

export function startSamplingSpan(model: string, options: SamplingSpanOptions) {
  return tracer.startSpan(
    `${MCP_METHODS.SAMPLING_CREATE_MESSAGE} ${model}`,
    {
      kind: SpanKind.CLIENT,
      attributes: {
        ...baseAttrs(MCP_METHODS.SAMPLING_CREATE_MESSAGE, options),
        "gen_ai.request.model": model,
      },
    },
    options.parentContext,
  );
}

export function endSpanSuccess(span: ReturnType<typeof tracer.startSpan>) {
  span.setStatus({ code: SpanStatusCode.OK });
  span.end();
}

export function endSpanError(
  span: ReturnType<typeof tracer.startSpan>,
  error: unknown,
) {
  const message = error instanceof Error ? error.message : String(error);
  const errorType =
    error instanceof Error ? error.constructor.name : "UnknownError";
  span.setStatus({ code: SpanStatusCode.ERROR, message });
  span.setAttribute("error.type", errorType);

  // JSON-RPC error code if available (MCP SDK errors often carry a code)
  const code = (error as Record<string, unknown> | null)?.code;
  if (typeof code === "number") {
    span.setAttribute("rpc.response.status_code", code);
  }

  span.end();
}
