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
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { ToadEyeConsoleExporter } from "../core/console-exporter.js";

const exporter = new ToadEyeConsoleExporter();
const provider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});

let stderrOutput: string[] = [];
const originalWrite = process.stderr.write;

beforeAll(() => {
  trace.setGlobalTracerProvider(provider);
  process.stderr.write = ((chunk: string) => {
    stderrOutput.push(chunk);
    return true;
  }) as typeof process.stderr.write;
});

afterEach(() => {
  stderrOutput = [];
});

afterAll(async () => {
  process.stderr.write = originalWrite;
  await provider.shutdown();
  trace.disable();
});

describe("ToadEyeConsoleExporter", () => {
  it("prints success span to stderr", () => {
    const tracer = trace.getTracer("test");
    const span = tracer.startSpan("chat gpt-4o");
    span.setStatus({ code: SpanStatusCode.OK });
    span.end();

    const output = stderrOutput.join("");
    expect(output).toContain("🐸 chat gpt-4o");
    expect(output).toContain("✅");
  });

  it("prints error span with error type", () => {
    const tracer = trace.getTracer("test");
    const span = tracer.startSpan("chat gpt-4o");
    span.setStatus({ code: SpanStatusCode.ERROR, message: "timeout" });
    span.setAttribute("error.type", "TimeoutError");
    span.end();

    const output = stderrOutput.join("");
    expect(output).toContain("❌");
    expect(output).toContain("TimeoutError");
  });

  it("shows cost when present", () => {
    const tracer = trace.getTracer("test");
    const span = tracer.startSpan("chat gpt-4o");
    span.setAttribute("gen_ai.toad_eye.cost", 0.0053);
    span.setStatus({ code: SpanStatusCode.OK });
    span.end();

    const output = stderrOutput.join("");
    expect(output).toContain("$0.0053");
  });

  it("filters out agent step spans", () => {
    const tracer = trace.getTracer("test");
    const span = tracer.startSpan("gen_ai.agent.step.think");
    span.setStatus({ code: SpanStatusCode.OK });
    span.end();

    expect(stderrOutput.join("")).not.toContain("gen_ai.agent.step.think");
  });

  it("formats duration correctly", () => {
    const tracer = trace.getTracer("test");
    const span = tracer.startSpan("tools/call calculate");
    span.setStatus({ code: SpanStatusCode.OK });
    span.end();

    const output = stderrOutput.join("");
    // Should contain some duration format (ms or s)
    expect(output).toMatch(/\[\d+ms\]|\[<1ms\]|\[\d+\.\d+s\]/);
  });

  it("shutdown resolves", async () => {
    await expect(exporter.shutdown()).resolves.toBeUndefined();
  });
});
