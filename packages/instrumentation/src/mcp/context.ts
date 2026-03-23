/**
 * W3C trace context extraction from MCP _meta field.
 *
 * In stdio transport, there are no HTTP headers. Context is passed
 * via the _meta field in JSON-RPC params:
 * { "params": { "_meta": { "traceparent": "00-..." } } }
 *
 * For SSE/HTTP transports, standard header propagation works too,
 * but _meta is the universal path that works everywhere.
 */

import { context, propagation, type Context } from "@opentelemetry/api";

export function extractContextFromMeta(
  meta?: Record<string, unknown>,
): Context {
  if (!meta?.["traceparent"]) return context.active();

  const carrier: Record<string, string> = {
    traceparent: String(meta["traceparent"]),
  };

  if (meta["tracestate"]) {
    carrier["tracestate"] = String(meta["tracestate"]);
  }

  return propagation.extract(context.active(), carrier);
}
