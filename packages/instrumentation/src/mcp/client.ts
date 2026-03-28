/**
 * MCP Client instrumentation — patches Client.prototype to create
 * SpanKind.CLIENT spans for outgoing tool calls, resource reads, and prompt gets.
 *
 * Injects W3C traceparent into _meta field so server-side middleware
 * can link client and server spans into one distributed trace.
 */

import { createRequire } from "node:module";
import {
  trace,
  context,
  propagation,
  SpanKind,
  SpanStatusCode,
} from "@opentelemetry/api";
import { MCP_METHODS } from "./spans.js";

const require = createRequire(import.meta.url);

const TRACER_NAME = "toad-eye-mcp-client";
const PATCHED_FLAG = "__toad_eye_mcp_client_patched";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let clientProto: any = null;
let originals: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  callTool: (...args: any[]) => Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readResource: (...args: any[]) => Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getPrompt: (...args: any[]) => Promise<any>;
} | null = null;

/**
 * Inject W3C traceparent into MCP _meta field.
 * This allows server-side middleware to extract parent context.
 */
function injectTraceContext(
  params: Record<string, unknown>,
): Record<string, unknown> {
  const meta = (params._meta as Record<string, unknown>) ?? {};
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);

  if (carrier["traceparent"]) {
    return {
      ...params,
      _meta: {
        ...meta,
        traceparent: carrier["traceparent"],
        ...(carrier["tracestate"] ? { tracestate: carrier["tracestate"] } : {}),
      },
    };
  }
  return params;
}

export function enableMcpClientInstrumentation(): boolean {
  try {
    require.resolve("@modelcontextprotocol/sdk/client/index.js");
  } catch {
    return false;
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sdk = require("@modelcontextprotocol/sdk/client/index.js");
  const Client = sdk.Client ?? sdk.default?.Client;

  if (!Client?.prototype) return false;
  if (Client.prototype[PATCHED_FLAG]) return true;

  const proto = Client.prototype;
  clientProto = proto;

  originals = {
    callTool: proto.callTool,
    readResource: proto.readResource,
    getPrompt: proto.getPrompt,
  };

  const tracer = trace.getTracer(TRACER_NAME);

  // --- Patch callTool ---
  proto.callTool = async function patchedCallTool(
    params: Record<string, unknown>,
    ...rest: unknown[]
  ) {
    const toolName = (params.name as string) ?? "unknown";
    const span = tracer.startSpan(`${MCP_METHODS.TOOLS_CALL} ${toolName}`, {
      kind: SpanKind.CLIENT,
      attributes: {
        "gen_ai.operation.name": MCP_METHODS.TOOLS_CALL,
        "mcp.method.name": MCP_METHODS.TOOLS_CALL,
        "gen_ai.tool.name": toolName,
      },
    });

    const enrichedParams = injectTraceContext(params);

    try {
      const result = await context.with(
        trace.setSpan(context.active(), span),
        () => originals!.callTool.call(this, enrichedParams, ...rest),
      );
      span.setStatus({ code: SpanStatusCode.OK });
      span.end();
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const errorType =
        error instanceof Error ? error.constructor.name : "UnknownError";
      span.setStatus({ code: SpanStatusCode.ERROR, message });
      span.setAttribute("error.type", errorType);
      span.end();
      throw error;
    }
  };

  // --- Patch readResource ---
  proto.readResource = async function patchedReadResource(
    params: Record<string, unknown>,
    ...rest: unknown[]
  ) {
    const uri = (params.uri as string) ?? "unknown";
    const span = tracer.startSpan(`${MCP_METHODS.RESOURCES_READ} ${uri}`, {
      kind: SpanKind.CLIENT,
      attributes: {
        "gen_ai.operation.name": MCP_METHODS.RESOURCES_READ,
        "mcp.method.name": MCP_METHODS.RESOURCES_READ,
        "gen_ai.data_source.id": uri,
      },
    });

    const enrichedParams = injectTraceContext(params);

    try {
      const result = await context.with(
        trace.setSpan(context.active(), span),
        () => originals!.readResource.call(this, enrichedParams, ...rest),
      );
      span.setStatus({ code: SpanStatusCode.OK });
      span.end();
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const errorType =
        error instanceof Error ? error.constructor.name : "UnknownError";
      span.setStatus({ code: SpanStatusCode.ERROR, message });
      span.setAttribute("error.type", errorType);
      span.end();
      throw error;
    }
  };

  // --- Patch getPrompt ---
  proto.getPrompt = async function patchedGetPrompt(
    params: Record<string, unknown>,
    ...rest: unknown[]
  ) {
    const promptName = (params.name as string) ?? "unknown";
    const span = tracer.startSpan(`${MCP_METHODS.PROMPTS_GET} ${promptName}`, {
      kind: SpanKind.CLIENT,
      attributes: {
        "gen_ai.operation.name": MCP_METHODS.PROMPTS_GET,
        "mcp.method.name": MCP_METHODS.PROMPTS_GET,
        "gen_ai.prompt.name": promptName,
      },
    });

    const enrichedParams = injectTraceContext(params);

    try {
      const result = await context.with(
        trace.setSpan(context.active(), span),
        () => originals!.getPrompt.call(this, enrichedParams, ...rest),
      );
      span.setStatus({ code: SpanStatusCode.OK });
      span.end();
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const errorType =
        error instanceof Error ? error.constructor.name : "UnknownError";
      span.setStatus({ code: SpanStatusCode.ERROR, message });
      span.setAttribute("error.type", errorType);
      span.end();
      throw error;
    }
  };

  proto[PATCHED_FLAG] = true;
  return true;
}

export function disableMcpClientInstrumentation() {
  if (!clientProto || !originals) return;

  clientProto.callTool = originals.callTool;
  clientProto.readResource = originals.readResource;
  clientProto.getPrompt = originals.getPrompt;
  delete clientProto[PATCHED_FLAG];

  clientProto = null;
  originals = null;
}
