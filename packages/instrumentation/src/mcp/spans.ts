/**
 * OTel span creation for MCP operations.
 *
 * Maps MCP methods to OTel GenAI semantic conventions:
 * - tools/call              → execute_tool {tool_name}
 * - resources/read          → retrieval {uri}
 * - prompts/get             → prompt {name}
 * - sampling/createMessage  → chat {model}
 */

import {
  trace,
  SpanStatusCode,
  SpanKind,
  type Context,
} from "@opentelemetry/api";

const TRACER_NAME = "toad-eye-mcp";

const tracer = trace.getTracer(TRACER_NAME);

export interface SpanOptions {
  readonly serverName: string;
  readonly serverVersion: string;
  readonly parentContext: Context;
}

export function startToolSpan(toolName: string, options: SpanOptions) {
  return tracer.startSpan(
    `execute_tool ${toolName}`,
    {
      kind: SpanKind.INTERNAL,
      attributes: {
        "gen_ai.operation.name": "execute_tool",
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
    `retrieval ${uri}`,
    {
      kind: SpanKind.INTERNAL,
      attributes: {
        "gen_ai.operation.name": "retrieval",
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
    `prompt ${promptName}`,
    {
      kind: SpanKind.INTERNAL,
      attributes: {
        "gen_ai.operation.name": "prompt",
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
    `chat ${model}`,
    {
      kind: SpanKind.CLIENT,
      attributes: {
        "gen_ai.operation.name": "chat",
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
  span.setStatus({ code: SpanStatusCode.ERROR, message });
  span.setAttribute("error.type", message);
  span.end();
}
