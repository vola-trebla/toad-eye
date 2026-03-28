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
}

export function startToolSpan(toolName: string, options: SpanOptions) {
  return tracer.startSpan(
    `${MCP_METHODS.TOOLS_CALL} ${toolName}`,
    {
      kind: SpanKind.INTERNAL,
      attributes: {
        "gen_ai.operation.name": MCP_METHODS.TOOLS_CALL,
        "mcp.method.name": MCP_METHODS.TOOLS_CALL,
        "gen_ai.tool.name": toolName,
        "mcp.server.name": options.serverName,
        "mcp.server.version": options.serverVersion,
      },
    },
    options.parentContext,
  );
}

export function startResourceSpan(uri: string, options: SpanOptions) {
  return tracer.startSpan(
    `${MCP_METHODS.RESOURCES_READ} ${uri}`,
    {
      kind: SpanKind.INTERNAL,
      attributes: {
        "gen_ai.operation.name": MCP_METHODS.RESOURCES_READ,
        "mcp.method.name": MCP_METHODS.RESOURCES_READ,
        "gen_ai.data_source.id": uri,
        "mcp.server.name": options.serverName,
        "mcp.server.version": options.serverVersion,
      },
    },
    options.parentContext,
  );
}

export function startPromptSpan(promptName: string, options: SpanOptions) {
  return tracer.startSpan(
    `${MCP_METHODS.PROMPTS_GET} ${promptName}`,
    {
      kind: SpanKind.INTERNAL,
      attributes: {
        "gen_ai.operation.name": MCP_METHODS.PROMPTS_GET,
        "mcp.method.name": MCP_METHODS.PROMPTS_GET,
        "gen_ai.prompt.name": promptName,
        "mcp.server.name": options.serverName,
        "mcp.server.version": options.serverVersion,
      },
    },
    options.parentContext,
  );
}

export interface SamplingSpanOptions {
  readonly serverName: string;
  readonly serverVersion: string;
  readonly parentContext?: Context | undefined;
}

export function startSamplingSpan(model: string, options: SamplingSpanOptions) {
  return tracer.startSpan(
    `${MCP_METHODS.SAMPLING_CREATE_MESSAGE} ${model}`,
    {
      kind: SpanKind.CLIENT,
      attributes: {
        "gen_ai.operation.name": MCP_METHODS.SAMPLING_CREATE_MESSAGE,
        "mcp.method.name": MCP_METHODS.SAMPLING_CREATE_MESSAGE,
        "gen_ai.request.model": model,
        "mcp.server.name": options.serverName,
        "mcp.server.version": options.serverVersion,
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
  span.end();
}
