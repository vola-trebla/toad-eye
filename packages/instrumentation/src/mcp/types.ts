import type { Span } from "@opentelemetry/api";

/** Configuration for toadEyeMiddleware(). */
export interface ToadMcpOptions {
  /** Record tool call arguments in spans. Default: false (privacy). */
  readonly recordInputs?: boolean | undefined;

  /** Record tool call results in spans. Default: false (privacy). */
  readonly recordOutputs?: boolean | undefined;

  /** Keys to redact from recorded arguments (recursive). */
  readonly redactKeys?: readonly string[] | undefined;

  /** Max payload size in characters before truncation. Default: 4096. */
  readonly maxPayloadSize?: number | undefined;

  /** Explicit session ID. Auto-generated if not provided. */
  readonly sessionId?: string | undefined;

  /** Extract W3C traceparent from _meta field. Default: true. */
  readonly propagateContext?: boolean | undefined;

  /** Hook called on each tool call span. Add custom attributes here. */
  readonly onToolCall?:
    | ((span: Span, toolName: string, args: unknown) => void)
    | undefined;

  /** Hook called on each resource read span. */
  readonly onResourceRead?: ((span: Span, uri: string) => void) | undefined;
}
