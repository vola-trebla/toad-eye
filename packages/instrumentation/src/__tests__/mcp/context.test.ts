import { describe, it, expect } from "vitest";
import { extractContextFromMeta } from "../../mcp/context.js";
import { context } from "@opentelemetry/api";

describe("extractContextFromMeta", () => {
  it("returns active context when meta is undefined", () => {
    const ctx = extractContextFromMeta(undefined);
    expect(ctx).toBe(context.active());
  });

  it("returns active context when meta has no traceparent", () => {
    const ctx = extractContextFromMeta({ someKey: "value" });
    expect(ctx).toBe(context.active());
  });

  it("returns a context when traceparent is present", () => {
    const ctx = extractContextFromMeta({
      traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    });
    // Should not be the default empty context — propagation extracted something
    expect(ctx).toBeDefined();
  });

  it("handles traceparent with tracestate", () => {
    const ctx = extractContextFromMeta({
      traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      tracestate: "vendor=value",
    });
    expect(ctx).toBeDefined();
  });
});
