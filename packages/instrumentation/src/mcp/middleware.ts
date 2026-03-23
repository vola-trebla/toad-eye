/**
 * MCP Server Middleware — wraps McpServer handler registration
 * to automatically instrument tool calls, resource reads, and prompt gets.
 *
 * Uses Wrapper Pattern: intercepts .tool(), .resource(), .prompt() methods
 * on the McpServer instance. Each handler is wrapped with OTel span creation.
 *
 * Why not monkey-patching: MCP SDK uses private class members (_requestHandlers)
 * and strict TypeScript. Wrapping the public API is the stable path.
 */

import {
  context,
  diag,
  DiagConsoleLogger,
  DiagLogLevel,
} from "@opentelemetry/api";
import type { ToadMcpOptions } from "./types.js";
import { extractContextFromMeta } from "./context.js";
import {
  startToolSpan,
  startResourceSpan,
  startPromptSpan,
  startSamplingSpan,
  endSpanSuccess,
  endSpanError,
} from "./spans.js";
import {
  recordMcpToolCall,
  recordMcpToolError,
  recordMcpResourceRead,
} from "./metrics.js";

const DEFAULT_MAX_PAYLOAD_SIZE = 4096;

function truncate(value: string, maxBytes: number): string {
  if (value.length <= maxBytes) return value;
  return value.slice(0, maxBytes) + "...[truncated]";
}

function redactObject(
  obj: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (typeof obj !== "object" || obj === null) return {};
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    result[k] = keys.includes(k) ? "[REDACTED]" : v;
  }
  return result;
}

/**
 * Instrument an MCP server with OpenTelemetry tracing.
 *
 * Wraps .tool(), .resource(), .prompt() registration methods so every
 * handler execution produces an OTel span with correct GenAI semconv attributes.
 *
 * @example
 * ```ts
 * import { McpServer } from "@modelcontextprotocol/sdk/server/index.js";
 * import { toadEyeMiddleware } from "toad-eye/mcp";
 *
 * const server = new McpServer({ name: "my-server", version: "1.0.0" });
 * toadEyeMiddleware(server);
 *
 * server.tool("calculate", { expression: z.string() }, async ({ expression }) => {
 *   return { content: [{ type: "text", text: String(eval(expression)) }] };
 * });
 * ```
 */
/**
 * Redirect OTel diagnostics to stderr to avoid polluting stdout.
 * In stdio MCP transport, stdout IS the JSON-RPC channel —
 * any stray console.log or OTel diagnostic would crash the connection.
 */
function ensureStdioSafe() {
  const stderrLogger = new DiagConsoleLogger();
  // Override the logger to use stderr-only methods
  const safeLogger = {
    verbose: (...args: unknown[]) => stderrLogger.verbose(String(args[0])),
    debug: (...args: unknown[]) => stderrLogger.debug(String(args[0])),
    info: (...args: unknown[]) => stderrLogger.info(String(args[0])),
    warn: (...args: unknown[]) => stderrLogger.warn(String(args[0])),
    error: (...args: unknown[]) => stderrLogger.error(String(args[0])),
  };
  diag.setLogger(safeLogger, DiagLogLevel.WARN);
}

export function toadEyeMiddleware(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  server: any,
  options: ToadMcpOptions = {},
) {
  ensureStdioSafe();
  const serverName: string = server.name ?? server._name ?? "mcp-server";
  const serverVersion: string = server.version ?? server._version ?? "unknown";
  const recordInputs = options.recordInputs ?? false;
  const recordOutputs = options.recordOutputs ?? false;
  const redactKeys = options.redactKeys ?? [];
  const maxPayload = options.maxPayloadSize ?? DEFAULT_MAX_PAYLOAD_SIZE;
  const propagate = options.propagateContext ?? true;

  const spanOpts = { serverName, serverVersion };

  // --- Wrap .tool() ---
  const originalTool = server.tool.bind(server);
  server.tool = function wrappedTool(name: string, ...rest: unknown[]) {
    // Find the handler — last function argument
    const handlerIndex = rest.findIndex((arg) => typeof arg === "function");
    if (handlerIndex === -1) {
      return originalTool(name, ...rest);
    }

    const originalHandler = rest[handlerIndex] as (
      ...args: unknown[]
    ) => Promise<unknown>;

    rest[handlerIndex] = async function wrappedHandler(
      ...handlerArgs: unknown[]
    ) {
      // Extract _meta for context propagation
      const firstArg = handlerArgs[0] as Record<string, unknown> | undefined;
      const meta = propagate
        ? ((firstArg as Record<string, unknown>)?._meta as
            | Record<string, unknown>
            | undefined)
        : undefined;
      const parentCtx = propagate
        ? extractContextFromMeta(meta)
        : context.active();

      const span = startToolSpan(name, {
        ...spanOpts,
        parentContext: parentCtx,
      });

      // Record inputs if enabled
      if (recordInputs && firstArg) {
        const sanitized =
          redactKeys.length > 0 ? redactObject(firstArg, redactKeys) : firstArg;
        const serialized = truncate(JSON.stringify(sanitized), maxPayload);
        span.setAttribute("gen_ai.tool.call.arguments", serialized);
      }

      // Custom hook
      if (options.onToolCall) {
        options.onToolCall(span, name, firstArg);
      }

      const start = performance.now();
      try {
        const result = await context.with(context.active(), () =>
          originalHandler(...handlerArgs),
        );
        const durationMs = performance.now() - start;

        // Record outputs if enabled
        if (recordOutputs && result) {
          const serialized = truncate(JSON.stringify(result), maxPayload);
          span.setAttribute("gen_ai.tool.call.result", serialized);
        }

        endSpanSuccess(span);
        recordMcpToolCall(name, durationMs, "success");
        return result;
      } catch (error) {
        const durationMs = performance.now() - start;
        const errorType =
          error instanceof Error ? error.constructor.name : "UnknownError";
        endSpanError(span, error);
        recordMcpToolCall(name, durationMs, "error");
        recordMcpToolError(name, errorType);
        throw error;
      }
    };

    return originalTool(name, ...rest);
  };

  // --- Wrap .resource() ---
  const originalResource = server.resource?.bind(server);
  if (originalResource) {
    server.resource = function wrappedResource(
      name: string,
      ...rest: unknown[]
    ) {
      const handlerIndex = rest.findIndex((arg) => typeof arg === "function");
      if (handlerIndex === -1) {
        return originalResource(name, ...rest);
      }

      const originalHandler = rest[handlerIndex] as (
        ...args: unknown[]
      ) => Promise<unknown>;

      rest[handlerIndex] = async function wrappedHandler(
        ...handlerArgs: unknown[]
      ) {
        const uri =
          ((handlerArgs[0] as Record<string, unknown>)?.uri as string) ?? name;
        const parentCtx = propagate
          ? extractContextFromMeta(
              (handlerArgs[0] as Record<string, unknown>)?._meta as
                | Record<string, unknown>
                | undefined,
            )
          : context.active();

        const span = startResourceSpan(uri, {
          ...spanOpts,
          parentContext: parentCtx,
        });

        if (options.onResourceRead) {
          options.onResourceRead(span, uri);
        }

        try {
          const result = await originalHandler(...handlerArgs);
          endSpanSuccess(span);
          recordMcpResourceRead(uri);
          return result;
        } catch (error) {
          endSpanError(span, error);
          throw error;
        }
      };

      return originalResource(name, ...rest);
    };
  }

  // --- Wrap .prompt() ---
  const originalPrompt = server.prompt?.bind(server);
  if (originalPrompt) {
    server.prompt = function wrappedPrompt(name: string, ...rest: unknown[]) {
      const handlerIndex = rest.findIndex((arg) => typeof arg === "function");
      if (handlerIndex === -1) {
        return originalPrompt(name, ...rest);
      }

      const originalHandler = rest[handlerIndex] as (
        ...args: unknown[]
      ) => Promise<unknown>;

      rest[handlerIndex] = async function wrappedHandler(
        ...handlerArgs: unknown[]
      ) {
        const parentCtx = propagate
          ? extractContextFromMeta(
              (handlerArgs[0] as Record<string, unknown>)?._meta as
                | Record<string, unknown>
                | undefined,
            )
          : context.active();

        const span = startPromptSpan(name, {
          ...spanOpts,
          parentContext: parentCtx,
        });

        try {
          const result = await originalHandler(...handlerArgs);
          endSpanSuccess(span);
          return result;
        } catch (error) {
          endSpanError(span, error);
          throw error;
        }
      };

      return originalPrompt(name, ...rest);
    };
  }
}

/**
 * Trace a sampling/createMessage call (server → client LLM request).
 *
 * Sampling is an outgoing request from the MCP server to the client,
 * asking the client's LLM to generate a response. This cannot be
 * auto-intercepted via wrapper pattern, so wrap manually.
 *
 * @example
 * ```ts
 * import { traceSampling } from "toad-eye/mcp";
 *
 * server.tool("summarize", { text: z.string() }, async ({ text }, ctx) => {
 *   const response = await traceSampling(
 *     () => ctx.mcpReq.requestSampling({
 *       messages: [{ role: "user", content: { type: "text", text } }],
 *       maxTokens: 500,
 *     }),
 *     { model: "gpt-4" }
 *   );
 *   return { content: [{ type: "text", text: response.content.text }] };
 * });
 * ```
 */
export async function traceSampling<T>(
  fn: () => Promise<T>,
  options: TraceSamplingOptions,
): Promise<T> {
  const model = options.model ?? "unknown";
  const span = startSamplingSpan(model, {
    serverName: options.serverName ?? "mcp-server",
    serverVersion: options.serverVersion ?? "unknown",
    parentContext: options.parentContext,
  });

  if (options.maxTokens !== undefined) {
    span.setAttribute("gen_ai.request.max_tokens", options.maxTokens);
  }

  const start = performance.now();
  try {
    const result = await fn();
    const durationMs = performance.now() - start;

    // Extract token usage from response if available
    const response = result as Record<string, unknown> | null;
    if (response && typeof response === "object") {
      if (response["model"]) {
        span.setAttribute("gen_ai.response.model", String(response["model"]));
      }
    }

    span.setAttribute("gen_ai.mcp.sampling.duration_ms", durationMs);
    endSpanSuccess(span);
    return result;
  } catch (error) {
    endSpanError(span, error);
    throw error;
  }
}

export interface TraceSamplingOptions {
  /** The model being requested for sampling. */
  readonly model?: string | undefined;

  /** Max tokens requested. */
  readonly maxTokens?: number | undefined;

  /** MCP server name for span attributes. */
  readonly serverName?: string | undefined;

  /** MCP server version for span attributes. */
  readonly serverVersion?: string | undefined;

  /** Parent OTel context. */
  readonly parentContext?: import("@opentelemetry/api").Context | undefined;
}
