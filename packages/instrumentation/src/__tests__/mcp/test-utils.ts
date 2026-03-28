/**
 * Shared OTel test utilities for MCP tests.
 *
 * Registers an in-memory span exporter so tests can capture and assert
 * on actual span attributes, status, and kind.
 */

import { trace, propagation, SpanStatusCode } from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { afterEach, beforeAll, afterAll } from "vitest";

export const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});

export function setupOTelForTests() {
  beforeAll(() => {
    trace.setGlobalTracerProvider(provider);
    propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  });

  afterEach(() => {
    exporter.reset();
  });

  afterAll(async () => {
    await provider.shutdown();
    trace.disable();
    propagation.disable();
  });
}

export function getSpans(): ReadableSpan[] {
  return exporter.getFinishedSpans();
}

export function findSpan(namePart: string): ReadableSpan | undefined {
  return getSpans().find((s) => s.name.includes(namePart));
}

export function getSpanAttr(
  span: ReadableSpan,
  key: string,
): string | number | boolean | undefined {
  return span.attributes[key] as string | number | boolean | undefined;
}

export { SpanStatusCode };
