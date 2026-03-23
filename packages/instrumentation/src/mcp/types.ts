import type { Span } from "@opentelemetry/api";

/** Configuration for toadEyeMiddleware(). */
export interface ToadMcpOptions {
  /** Service name for OTel resource. Defaults to MCP server name. */
  readonly serviceName?: string | undefined;

  /** OTLP endpoint. Uses existing OTel config if initObservability() was called. */
  readonly endpoint?: string | undefined;

  /** Record tool call arguments in spans. Default: false (privacy). */
  readonly recordInputs?: boolean | undefined;

  /** Record tool call results in spans. Default: false (privacy). */
  readonly recordOutputs?: boolean | undefined;

  /** Keys to redact from recorded arguments. */
  readonly redactKeys?: readonly string[] | undefined;

  /** Max payload size in bytes before truncation. Default: 4096. */
  readonly maxPayloadSize?: number | undefined;

  /** Extract W3C traceparent from _meta field. Default: true. */
  readonly propagateContext?: boolean | undefined;

  /** Hook called on each tool call span. Add custom attributes here. */
  readonly onToolCall?:
    | ((span: Span, toolName: string, args: unknown) => void)
    | undefined;

  /** Hook called on each resource read span. */
  readonly onResourceRead?: ((span: Span, uri: string) => void) | undefined;
}

/** OTel attributes set on MCP spans. */
export interface McpSpanAttributes {
  readonly "gen_ai.operation.name": string;
  readonly "gen_ai.tool.name"?: string;
  readonly "gen_ai.tool.call.id"?: string;
  readonly "gen_ai.data_source.id"?: string;
  readonly "gen_ai.prompt.name"?: string;
  readonly "mcp.server.name": string;
  readonly "mcp.server.version": string;
  readonly "mcp.transport"?: "stdio" | "sse" | "streamable-http";
  readonly "mcp.session.id"?: string;
}
