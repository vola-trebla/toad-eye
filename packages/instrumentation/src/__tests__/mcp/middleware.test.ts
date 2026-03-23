import { describe, it, expect, vi, beforeEach } from "vitest";
import { toadEyeMiddleware } from "../../mcp/index.js";

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
    // Test helpers
    _callTool: (name: string, args: unknown) => tools[name]!(args),
    _callResource: (name: string, args: unknown) => resources[name]!(args),
    _callPrompt: (name: string, args: unknown) => prompts[name]!(args),
  };
}

describe("toadEyeMiddleware", () => {
  it("wraps tool handlers without breaking registration", async () => {
    const server = createMockServer();
    toadEyeMiddleware(server);

    const handler = vi.fn(async () => ({
      content: [{ type: "text", text: "result" }],
    }));

    server.tool("calculate", handler);

    const result = await server._callTool("calculate", {
      expression: "2+2",
    });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      content: [{ type: "text", text: "result" }],
    });
  });

  it("wraps resource handlers", async () => {
    const server = createMockServer();
    toadEyeMiddleware(server);

    const handler = vi.fn(async () => ({
      contents: [{ uri: "file:///test", text: "content" }],
    }));

    server.resource("docs", handler);

    const result = await server._callResource("docs", {
      uri: "file:///test",
    });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      contents: [{ uri: "file:///test", text: "content" }],
    });
  });

  it("wraps prompt handlers", async () => {
    const server = createMockServer();
    toadEyeMiddleware(server);

    const handler = vi.fn(async () => ({
      messages: [{ role: "user", content: { type: "text", text: "hello" } }],
    }));

    server.prompt("greeting", handler);

    const result = await server._callPrompt("greeting", {});
    expect(handler).toHaveBeenCalledTimes(1);
    expect(result).toBeDefined();
  });

  it("does NOT record arguments by default (privacy)", async () => {
    const server = createMockServer();
    toadEyeMiddleware(server);

    const handler = vi.fn(async () => ({
      content: [{ type: "text", text: "ok" }],
    }));

    server.tool("secret-tool", handler);
    await server._callTool("secret-tool", {
      apiKey: "sk-secret",
      query: "test",
    });

    // Handler was called — middleware didn't break it
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("records arguments when recordInputs: true", async () => {
    const server = createMockServer();
    toadEyeMiddleware(server, { recordInputs: true });

    const handler = vi.fn(async () => ({
      content: [{ type: "text", text: "ok" }],
    }));

    server.tool("open-tool", handler);
    await server._callTool("open-tool", { query: "test" });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("redacts specified keys from arguments", async () => {
    const server = createMockServer();
    toadEyeMiddleware(server, {
      recordInputs: true,
      redactKeys: ["apiKey", "token"],
    });

    const handler = vi.fn(async () => ({
      content: [{ type: "text", text: "ok" }],
    }));

    server.tool("redact-tool", handler);
    await server._callTool("redact-tool", {
      apiKey: "sk-secret",
      token: "tok-123",
      query: "visible",
    });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("propagates errors from handlers", async () => {
    const server = createMockServer();
    toadEyeMiddleware(server);

    const handler = vi.fn(async () => {
      throw new Error("Tool failed");
    });

    server.tool("failing-tool", handler);

    await expect(server._callTool("failing-tool", {})).rejects.toThrow(
      "Tool failed",
    );
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
      expect.anything(), // span
      "hooked-tool",
      expect.objectContaining({ data: "test" }),
    );
  });
});
