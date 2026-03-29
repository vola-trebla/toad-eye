import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  afterEach,
} from "vitest";
import { trace, SpanStatusCode } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import {
  ToadEyeSpanEndProcessor,
  type SpanEndData,
} from "../core/span-end-processor.js";

const exporter = new InMemorySpanExporter();
const collected: SpanEndData[] = [];
const callback = vi.fn((data: SpanEndData) => {
  collected.push(data);
});

const processor = new ToadEyeSpanEndProcessor(callback);
const provider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter), processor],
});

beforeAll(() => {
  trace.setGlobalTracerProvider(provider);
});

afterEach(() => {
  exporter.reset();
  collected.length = 0;
  callback.mockClear();
});

afterAll(async () => {
  await provider.shutdown();
  trace.disable();
});

describe("ToadEyeSpanEndProcessor", () => {
  it("calls callback with structured span data", () => {
    const tracer = trace.getTracer("test");
    const span = tracer.startSpan("test-span");
    span.setAttribute("gen_ai.request.model", "gpt-4o");
    span.setAttribute("gen_ai.usage.input_tokens", 100);
    span.setStatus({ code: SpanStatusCode.OK });
    span.end();

    expect(callback).toHaveBeenCalledTimes(1);
    const data = collected[0]!;
    expect(data.name).toBe("test-span");
    expect(data.status).toBe("ok");
    expect(data.attributes["gen_ai.request.model"]).toBe("gpt-4o");
    expect(data.attributes["gen_ai.usage.input_tokens"]).toBe(100);
    expect(data.traceId).toHaveLength(32);
    expect(data.spanId).toHaveLength(16);
    expect(data.durationMs).toBeGreaterThanOrEqual(0);
    expect(data.kind).toBe("internal");
    expect(data.startTime).toBeInstanceOf(Date);
    expect(data.endTime).toBeInstanceOf(Date);
  });

  it("reports error status and message", () => {
    const tracer = trace.getTracer("test");
    const span = tracer.startSpan("error-span");
    span.setStatus({ code: SpanStatusCode.ERROR, message: "boom" });
    span.end();

    const data = collected[0]!;
    expect(data.status).toBe("error");
    expect(data.error).toBe("boom");
  });

  it("reports unset status when no status is set", () => {
    const tracer = trace.getTracer("test");
    const span = tracer.startSpan("unset-span");
    span.end();

    const data = collected[0]!;
    expect(data.status).toBe("unset");
    expect(data.error).toBeUndefined();
  });

  it("does not throw on sync callback error", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failingProcessor = new ToadEyeSpanEndProcessor(() => {
      throw new Error("sync fail");
    });

    // Call onEnd directly — no need for a full provider
    const _span = exporter.getFinishedSpans()[0];
    // Create a real span to pass
    const tracer = trace.getTracer("test");
    const testSpan = tracer.startSpan("direct-test");
    testSpan.end();
    const finishedSpan = exporter.getFinishedSpans()[0]!;

    failingProcessor.onEnd(finishedSpan);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("onSpanEnd callback failed"),
    );
    warnSpy.mockRestore();
  });

  it("does not throw on async callback error", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failingProcessor = new ToadEyeSpanEndProcessor(async () => {
      throw new Error("async fail");
    });

    const tracer = trace.getTracer("test");
    const testSpan = tracer.startSpan("async-test");
    testSpan.end();
    const finishedSpan = exporter.getFinishedSpans()[0]!;

    failingProcessor.onEnd(finishedSpan);

    // Wait for async rejection to be caught
    await new Promise((r) => setTimeout(r, 10));

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("onSpanEnd callback failed"),
    );
    warnSpy.mockRestore();
  });
});
