import { describe, it, expect, vi } from "vitest";
import { SpanKind } from "@opentelemetry/api";
import { toadEyeMiddleware, traceSampling } from "../../mcp/index.js";
import {
  setupOTelForTests,
  findSpan,
  getSpanAttr,
  getSpans,
  SpanStatusCode,
} from "./test-utils.js";

function createMockServer() {
  const tools: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  const resources: Record<string, (...args: unknown[]) => Promise<unknown>> =
    {};
  const prompts: Record<string, (...args: unknown[]) => Promise<unknown>> = {};

  return {
    name: "test-server",
    version: "1.0.0",
    tool(name: string, ...rest: unknown[]) {
      const handler = rest.find((arg) => typeof arg === "function") as (
        ...args: unknown[]
      ) => Promise<unknown>;
      tools[name] = handler;
    },
    resource(name: string, ...rest: unknown[]) {
      const handler = rest.find((arg) => typeof arg === "function") as (
        ...args: unknown[]
      ) => Promise<unknown>;
      resources[name] = handler;
    },
    prompt(name: string, ...rest: unknown[]) {
      const handler = rest.find((arg) => typeof arg === "function") as (
        ...args: unknown[]
      ) => Promise<unknown>;
      prompts[name] = handler;
    },
    _callTool: (name: string, args: unknown) => tools[name]!(args),
    _callResource: (name: string, args: unknown) => resources[name]!(args),
    _callPrompt: (name: string, args: unknown) => prompts[name]!(args),
  };
}

// Setup OTel once for the entire file
setupOTelForTests();

describe("toadEyeMiddleware", () => {
  it("creates a SERVER span with correct attributes for tool calls", async () => {
    const server = createMockServer();
    toadEyeMiddleware(server);

    server.tool("calculate", async () => ({
      content: [{ type: "text", text: "4" }],
    }));

    await server._callTool("calculate", { expression: "2+2" });

    const span = findSpan("tools/call calculate");
    expect(span).toBeDefined();
    expect(span!.kind).toBe(SpanKind.SERVER);
    expect(getSpanAttr(span!, "gen_ai.operation.name")).toBe("tools/call");
    expect(getSpanAttr(span!, "mcp.method.name")).toBe("tools/call");
    expect(getSpanAttr(span!, "gen_ai.tool.name")).toBe("calculate");
    expect(getSpanAttr(span!, "mcp.server.name")).toBe("test-server");
    expect(span!.status.code).toBe(SpanStatusCode.OK);
  });

  it("creates a SERVER span for resource reads", async () => {
    const server = createMockServer();
    toadEyeMiddleware(server);

    server.resource("docs", async () => ({
      contents: [{ uri: "file:///test", text: "content" }],
    }));

    await server._callResource("docs", { uri: "file:///test" });

    const span = findSpan("resources/read");
    expect(span).toBeDefined();
    expect(span!.kind).toBe(SpanKind.SERVER);
    expect(getSpanAttr(span!, "gen_ai.operation.name")).toBe("resources/read");
  });

  it("creates a SERVER span for prompt gets", async () => {
    const server = createMockServer();
    toadEyeMiddleware(server);

    server.prompt("greeting", async () => ({
      messages: [{ role: "user", content: { type: "text", text: "hi" } }],
    }));

    await server._callPrompt("greeting", {});

    const span = findSpan("prompts/get greeting");
    expect(span).toBeDefined();
    expect(span!.kind).toBe(SpanKind.SERVER);
    expect(getSpanAttr(span!, "gen_ai.operation.name")).toBe("prompts/get");
  });

  it("does NOT record arguments by default (privacy)", async () => {
    const server = createMockServer();
    toadEyeMiddleware(server);

    server.tool("secret-tool", async () => ({
      content: [{ type: "text", text: "ok" }],
    }));

    await server._callTool("secret-tool", {
      apiKey: "sk-secret",
      query: "test",
    });

    const span = findSpan("tools/call secret-tool");
    expect(span).toBeDefined();
    expect(span!.attributes["gen_ai.tool.call.arguments"]).toBeUndefined();
  });

  it("records arguments when recordInputs: true", async () => {
    const server = createMockServer();
    toadEyeMiddleware(server, { recordInputs: true });

    server.tool("open-tool", async () => ({
      content: [{ type: "text", text: "ok" }],
    }));

    await server._callTool("open-tool", { query: "test" });

    const span = findSpan("tools/call open-tool");
    expect(span).toBeDefined();
    const args = span!.attributes["gen_ai.tool.call.arguments"] as string;
    expect(args).toBeDefined();
    expect(JSON.parse(args)).toMatchObject({ query: "test" });
  });

  it("redacts specified keys from arguments (top-level)", async () => {
    const server = createMockServer();
    toadEyeMiddleware(server, {
      recordInputs: true,
      redactKeys: ["apiKey", "token"],
    });

    server.tool("redact-tool", async () => ({
      content: [{ type: "text", text: "ok" }],
    }));

    await server._callTool("redact-tool", {
      apiKey: "sk-secret",
      token: "tok-123",
      query: "visible",
    });

    const span = findSpan("tools/call redact-tool");
    const args = JSON.parse(
      span!.attributes["gen_ai.tool.call.arguments"] as string,
    );
    expect(args.apiKey).toBe("[REDACTED]");
    expect(args.token).toBe("[REDACTED]");
    expect(args.query).toBe("visible");
  });

  it("redacts nested keys recursively", async () => {
    const server = createMockServer();
    toadEyeMiddleware(server, {
      recordInputs: true,
      redactKeys: ["apiKey"],
    });

    server.tool("nested-tool", async () => ({
      content: [{ type: "text", text: "ok" }],
    }));

    await server._callTool("nested-tool", {
      config: {
        apiKey: "sk-nested-secret",
        endpoint: "https://api.example.com",
      },
      query: "test",
    });

    const span = findSpan("tools/call nested-tool");
    const args = JSON.parse(
      span!.attributes["gen_ai.tool.call.arguments"] as string,
    );
    expect(args.config.apiKey).toBe("[REDACTED]");
    expect(args.config.endpoint).toBe("https://api.example.com");
    expect(args.query).toBe("test");
  });

  it("records outputs when recordOutputs: true", async () => {
    const server = createMockServer();
    toadEyeMiddleware(server, { recordOutputs: true });

    server.tool("output-tool", async () => ({
      content: [{ type: "text", text: "the result" }],
    }));

    await server._callTool("output-tool", {});

    const span = findSpan("tools/call output-tool");
    expect(span).toBeDefined();
    const result = span!.attributes["gen_ai.tool.call.result"] as string;
    expect(result).toBeDefined();
    expect(JSON.parse(result)).toMatchObject({
      content: [{ type: "text", text: "the result" }],
    });
  });

  it("does NOT record outputs by default", async () => {
    const server = createMockServer();
    toadEyeMiddleware(server);

    server.tool("no-output", async () => ({
      content: [{ type: "text", text: "hidden" }],
    }));

    await server._callTool("no-output", {});

    const span = findSpan("tools/call no-output");
    expect(span!.attributes["gen_ai.tool.call.result"]).toBeUndefined();
  });

  it("sets ERROR status and error.type on handler failure", async () => {
    const server = createMockServer();
    toadEyeMiddleware(server);

    server.tool("failing-tool", async () => {
      throw new TypeError("invalid input");
    });

    await expect(server._callTool("failing-tool", {})).rejects.toThrow(
      "invalid input",
    );

    const span = findSpan("tools/call failing-tool");
    expect(span).toBeDefined();
    expect(span!.status.code).toBe(SpanStatusCode.ERROR);
    expect(span!.status.message).toBe("invalid input");
    expect(getSpanAttr(span!, "error.type")).toBe("TypeError");
  });

  it("calls onToolCall hook with span", async () => {
    const onToolCall = vi.fn();
    const server = createMockServer();
    toadEyeMiddleware(server, { onToolCall });

    server.tool("hooked-tool", async () => ({
      content: [{ type: "text", text: "ok" }],
    }));

    await server._callTool("hooked-tool", { data: "test" });

    expect(onToolCall).toHaveBeenCalledTimes(1);
    expect(onToolCall).toHaveBeenCalledWith(
      expect.anything(),
      "hooked-tool",
      expect.objectContaining({ data: "test" }),
    );
  });

  it("returns a dispose callback that is idempotent", () => {
    const server = createMockServer();
    const dispose = toadEyeMiddleware(server);
    expect(typeof dispose).toBe("function");
    // Should not throw when called multiple times
    dispose();
    dispose();
  });
});

describe("traceSampling", () => {
  it("creates a CLIENT span with model attribute", async () => {
    const result = await traceSampling(
      async () => ({ model: "gpt-4", content: "hello" }),
      { model: "gpt-4", serverName: "test", serverVersion: "1.0.0" },
    );

    expect(result).toEqual({ model: "gpt-4", content: "hello" });

    const span = findSpan("sampling/createMessage gpt-4");
    expect(span).toBeDefined();
    expect(span!.kind).toBe(SpanKind.CLIENT);
    expect(getSpanAttr(span!, "gen_ai.request.model")).toBe("gpt-4");
    expect(getSpanAttr(span!, "gen_ai.operation.name")).toBe(
      "sampling/createMessage",
    );
  });

  it("records maxTokens attribute when provided", async () => {
    await traceSampling(async () => ({}), {
      model: "gpt-4",
      maxTokens: 500,
    });

    const span = findSpan("sampling/createMessage");
    expect(span).toBeDefined();
    expect(getSpanAttr(span!, "gen_ai.request.max_tokens")).toBe(500);
  });

  it("does NOT set maxTokens when omitted", async () => {
    await traceSampling(async () => ({}), { model: "gpt-4" });

    const span = findSpan("sampling/createMessage");
    expect(span!.attributes["gen_ai.request.max_tokens"]).toBeUndefined();
  });

  it("sets ERROR status on failure", async () => {
    await expect(
      traceSampling(
        async () => {
          throw new Error("Sampling failed");
        },
        { model: "gpt-4" },
      ),
    ).rejects.toThrow("Sampling failed");

    const span = findSpan("sampling/createMessage");
    expect(span!.status.code).toBe(SpanStatusCode.ERROR);
    expect(getSpanAttr(span!, "error.type")).toBe("Error");
  });

  it("records response model when present in result", async () => {
    await traceSampling(async () => ({ model: "gpt-4-turbo" }), {
      model: "gpt-4",
    });

    const span = findSpan("sampling/createMessage");
    expect(getSpanAttr(span!, "gen_ai.response.model")).toBe("gpt-4-turbo");
  });
});
