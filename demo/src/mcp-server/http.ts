/**
 * Demo MCP server over Streamable HTTP transport.
 *
 * Run:  npx tsx demo/src/mcp-server/http.ts
 * Test: curl -X POST http://localhost:3500/mcp \
 *         -H "Content-Type: application/json" \
 *         -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}'
 *
 * Or use MCP Inspector:
 *   npx @modelcontextprotocol/inspector --transport streamablehttp http://localhost:3500/mcp
 *
 * Requires observability stack running: npx toad-eye up
 */

import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { initObservability, shutdown } from "toad-eye";
import { toadEyeMiddleware } from "toad-eye/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

const PORT = 3500;

initObservability({
  serviceName: "toad-eye-mcp-http-demo",
  endpoint: process.env["OTEL_EXPORTER_ENDPOINT"] ?? "http://localhost:4318",
});

// Track sessions
const transports = new Map<string, StreamableHTTPServerTransport>();

function createMcpServer() {
  const server = new McpServer({
    name: "toad-eye-mcp-http-demo",
    version: "1.0.0",
  });

  toadEyeMiddleware(server, {
    recordInputs: true,
    recordOutputs: true,
  });

  // Same tools as stdio demo
  server.tool(
    "calculate",
    "Evaluate a math expression (e.g. '2 + 2 * 3')",
    { expression: z.string().describe("Math expression to evaluate") },
    async ({ expression }) => {
      const sanitized = expression.replace(/[^0-9+\-*/().% ]/g, "");
      if (sanitized !== expression) {
        throw new Error(`Invalid characters in expression: ${expression}`);
      }
      const result = new Function(`return (${sanitized})`)() as number;
      return {
        content: [{ type: "text", text: `${expression} = ${result}` }],
      };
    },
  );

  server.tool(
    "get-weather",
    "Get current weather for a city (mock data)",
    { city: z.string().describe("City name") },
    async ({ city }) => {
      await new Promise((r) => setTimeout(r, 50 + Math.random() * 200));

      const conditions = [
        "sunny",
        "cloudy",
        "rainy",
        "snowy",
        "windy",
      ] as const;
      const condition =
        conditions[Math.floor(Math.random() * conditions.length)]!;
      const tempC = Math.round(-10 + Math.random() * 45);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                city,
                condition,
                temperature: {
                  celsius: tempC,
                  fahrenheit: Math.round(tempC * 1.8 + 32),
                },
                humidity: Math.round(30 + Math.random() * 60),
                updatedAt: new Date().toISOString(),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    "timestamp",
    "Get current timestamp in multiple formats",
    {},
    async () => {
      const now = new Date();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                iso: now.toISOString(),
                unix: Math.floor(now.getTime() / 1000),
                unixMs: now.getTime(),
                utc: now.toUTCString(),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.resource("server-info", "toad-eye-mcp-http-demo://info", async () => ({
    contents: [
      {
        uri: "toad-eye-mcp-http-demo://info",
        text: JSON.stringify(
          {
            name: "toad-eye-mcp-http-demo",
            version: "1.0.0",
            transport: "streamable-http",
            tools: ["calculate", "get-weather", "timestamp"],
            observability: "toad-eye middleware active",
          },
          null,
          2,
        ),
      },
    ],
  }));

  return server;
}

const httpServer = createServer(async (req, res) => {
  // CORS for browser-based clients
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, mcp-session-id");
  res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url !== "/mcp") {
    res.writeHead(404);
    res.end("Not Found");
    return;
  }

  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  // POST — tool calls and initialize
  if (req.method === "POST") {
    const body = await readBody(req);
    const parsed = JSON.parse(body);

    if (sessionId && transports.has(sessionId)) {
      await transports.get(sessionId)!.handleRequest(req, res, parsed);
      return;
    }

    if (!sessionId && isInitializeRequest(parsed)) {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          transports.set(id, transport);
          console.error(`  Session created: ${id}`);
        },
      });

      transport.onclose = () => {
        if (transport.sessionId) {
          transports.delete(transport.sessionId);
          console.error(`  Session closed: ${transport.sessionId}`);
        }
      };

      const server = createMcpServer();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await server.connect(transport as any);
      await transport.handleRequest(req, res, parsed);
      return;
    }

    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Invalid session" },
        id: null,
      }),
    );
    return;
  }

  // GET — SSE stream for session
  if (req.method === "GET") {
    if (sessionId && transports.has(sessionId)) {
      await transports.get(sessionId)!.handleRequest(req, res);
      return;
    }
    res.writeHead(400);
    res.end("Invalid session");
    return;
  }

  // DELETE — close session
  if (req.method === "DELETE") {
    if (sessionId && transports.has(sessionId)) {
      await transports.get(sessionId)!.handleRequest(req, res);
      return;
    }
    res.writeHead(400);
    res.end("Invalid session");
    return;
  }

  res.writeHead(405);
  res.end("Method Not Allowed");
});

function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

httpServer.listen(PORT, () => {
  console.error(
    `toad-eye MCP HTTP demo server running on http://localhost:${PORT}/mcp`,
  );
  console.error("  Traces → Jaeger:     http://localhost:16686");
  console.error("  Metrics → Prometheus: http://localhost:9090");
  console.error("  Dashboards → Grafana: http://localhost:3100");
  console.error("");
  console.error("Test with MCP Inspector:");
  console.error(
    `  npx @modelcontextprotocol/inspector --transport streamablehttp http://localhost:${PORT}/mcp`,
  );
});

process.on("SIGINT", async () => {
  console.error("\nShutting down...");
  httpServer.close();
  await shutdown();
  process.exit(0);
});
