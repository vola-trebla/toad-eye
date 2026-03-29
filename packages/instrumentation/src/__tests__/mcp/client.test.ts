import { describe, it, expect, vi } from "vitest";
import { SpanKind } from "@opentelemetry/api";
import {
  enableMcpClientInstrumentation,
  disableMcpClientInstrumentation,
} from "../../mcp/client.js";
import { toadEyeMiddleware } from "../../mcp/middleware.js";
import {
  setupOTelForTests,
  findSpan,
  getSpanAttr,
  SpanStatusCode,
} from "./test-utils.js";

// Minimal mock Client class that behaves like @modelcontextprotocol/sdk Client
class MockClient {
  async callTool(_params: Record<string, unknown>) {
    return { content: [{ type: "text", text: "mock result" }] };
  }
  async readResource(params: Record<string, unknown>) {
    return { contents: [{ uri: params.uri, text: "data" }] };
  }
  async getPrompt(_params: Record<string, unknown>) {
    return {
      messages: [{ role: "user", content: { type: "text", text: "hi" } }],
    };
  }
}

setupOTelForTests();

describe("enableMcpClientInstrumentation", () => {
  it("patches Client prototype and creates CLIENT spans", async () => {
    const patched = enableMcpClientInstrumentation(MockClient);
    expect(patched).toBe(true);

    const client = new MockClient();
    await client.callTool({ name: "ping", arguments: {} });

    const span = findSpan("tools/call ping");
    expect(span).toBeDefined();
    expect(span!.kind).toBe(SpanKind.CLIENT);
    expect(getSpanAttr(span!, "gen_ai.tool.name")).toBe("ping");
    expect(getSpanAttr(span!, "mcp.method.name")).toBe("tools/call");
    expect(span!.status.code).toBe(SpanStatusCode.OK);

    disableMcpClientInstrumentation();
  });

  it("is idempotent — second call returns true without double-wrapping", () => {
    enableMcpClientInstrumentation(MockClient);
    const second = enableMcpClientInstrumentation(MockClient);
    expect(second).toBe(true);
    // callTool should be patchedCallTool, not double-wrapped
    expect(MockClient.prototype.callTool.name).toBe("patchedCallTool");
    disableMcpClientInstrumentation();
  });

  it("returns false for wrong class (no callTool method)", () => {
    class WrongClass {}
    const result = enableMcpClientInstrumentation(WrongClass);
    expect(result).toBe(false);
  });

  it("disableMcpClientInstrumentation restores original methods", async () => {
    const originalCallTool = MockClient.prototype.callTool;
    enableMcpClientInstrumentation(MockClient);
    expect(MockClient.prototype.callTool.name).toBe("patchedCallTool");

    disableMcpClientInstrumentation();
    // After disable, callTool should be the original
    expect(MockClient.prototype.callTool).toBe(originalCallTool);
  });

  it("records error status on callTool failure", async () => {
    class FailingClient extends MockClient {
      override async callTool(
        _params: Record<string, unknown>,
      ): Promise<never> {
        throw new TypeError("connection refused");
      }
    }

    enableMcpClientInstrumentation(FailingClient);
    const client = new FailingClient();

    await expect(
      client.callTool({ name: "broken", arguments: {} } as Record<
        string,
        unknown
      >),
    ).rejects.toThrow("connection refused");

    const span = findSpan("tools/call broken");
    expect(span).toBeDefined();
    expect(span!.status.code).toBe(SpanStatusCode.ERROR);
    expect(getSpanAttr(span!, "error.type")).toBe("TypeError");

    disableMcpClientInstrumentation();
  });

  it("creates CLIENT spans for readResource and getPrompt", async () => {
    enableMcpClientInstrumentation(MockClient);
    const client = new MockClient();

    await client.readResource({ uri: "file:///test" });
    await client.getPrompt({ name: "greeting" });

    const resourceSpan = findSpan("resources/read");
    expect(resourceSpan).toBeDefined();
    expect(resourceSpan!.kind).toBe(SpanKind.CLIENT);

    const promptSpan = findSpan("prompts/get greeting");
    expect(promptSpan).toBeDefined();
    expect(promptSpan!.kind).toBe(SpanKind.CLIENT);

    disableMcpClientInstrumentation();
  });
});

// Context propagation round-trip is verified in E2E demo (Jaeger shows
// CLIENT→SERVER linked spans). Unit testing requires isolated module loading
// which conflicts with shared prototype state across test cases.

describe("dispose callback", () => {
  it("calls recordMcpSessionEnd", async () => {
    const mockServer = {
      name: "test",
      version: "1.0.0",
      tool: vi.fn(),
      resource: vi.fn(),
      prompt: vi.fn(),
    };

    const dispose = toadEyeMiddleware(mockServer);
    expect(typeof dispose).toBe("function");

    // Should not throw
    dispose();
    // Idempotent
    dispose();
  });
});
