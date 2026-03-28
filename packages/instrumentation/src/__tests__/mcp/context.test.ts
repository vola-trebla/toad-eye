import { describe, it, expect } from "vitest";
import { extractContextFromMeta } from "../../mcp/context.js";
import { context, trace } from "@opentelemetry/api";
import { setupOTelForTests } from "./test-utils.js";

describe("extractContextFromMeta", () => {
  setupOTelForTests();

  it("returns active context when meta is undefined", () => {
    const ctx = extractContextFromMeta(undefined);
    expect(ctx).toBe(context.active());
  });

  it("returns active context when meta has no traceparent", () => {
    const ctx = extractContextFromMeta({ someKey: "value" });
    expect(ctx).toBe(context.active());
  });

  it("extracts correct traceId and spanId from traceparent", () => {
    const ctx = extractContextFromMeta({
      traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    });
    const spanCtx = trace.getSpanContext(ctx);
    expect(spanCtx).toBeDefined();
    expect(spanCtx!.traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    expect(spanCtx!.spanId).toBe("00f067aa0ba902b7");
    expect(spanCtx!.traceFlags).toBe(1); // sampled
  });

  it("extracts traceparent with tracestate", () => {
    const ctx = extractContextFromMeta({
      traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      tracestate: "vendor=value",
    });
    const spanCtx = trace.getSpanContext(ctx);
    expect(spanCtx).toBeDefined();
    expect(spanCtx!.traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
  });
});
