/**
 * Demo MCP server with toad-eye observability middleware.
 *
 * Run:   npx tsx demo/src/mcp-server/index.ts
 * Test:  npx @modelcontextprotocol/inspector npx tsx demo/src/mcp-server/index.ts
 *
 * Requires observability stack running: npx toad-eye up
 */

import { initObservability } from "toad-eye";
import { toadEyeMiddleware } from "toad-eye/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// Initialize OTel — sends traces + metrics to local collector
initObservability({
  serviceName: "toad-eye-mcp-demo",
  endpoint: process.env["OTEL_EXPORTER_ENDPOINT"] ?? "http://localhost:4318",
});

const server = new McpServer({
  name: "toad-eye-mcp-demo",
  version: "1.0.0",
});

// One-line instrumentation — all tools/resources/prompts are traced
toadEyeMiddleware(server, {
  recordInputs: true,
  recordOutputs: true,
});

// --- Tools ---

server.tool(
  "calculate",
  "Evaluate a math expression (e.g. '2 + 2 * 3')",
  { expression: z.string().describe("Math expression to evaluate") },
  async ({ expression }) => {
    // Safe math evaluation — only allows numbers and operators
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
    // Simulate API latency
    await new Promise((r) => setTimeout(r, 50 + Math.random() * 200));

    const conditions = ["sunny", "cloudy", "rainy", "snowy", "windy"] as const;
    const condition =
      conditions[Math.floor(Math.random() * conditions.length)]!;
    const tempC = Math.round(-10 + Math.random() * 45);

    const weather = {
      city,
      condition,
      temperature: { celsius: tempC, fahrenheit: Math.round(tempC * 1.8 + 32) },
      humidity: Math.round(30 + Math.random() * 60),
      updatedAt: new Date().toISOString(),
    };

    return {
      content: [{ type: "text", text: JSON.stringify(weather, null, 2) }],
    };
  },
);

server.tool(
  "timestamp",
  "Get current timestamp in multiple formats",
  {},
  async () => {
    const now = new Date();
    const ts = {
      iso: now.toISOString(),
      unix: Math.floor(now.getTime() / 1000),
      unixMs: now.getTime(),
      utc: now.toUTCString(),
    };
    return {
      content: [{ type: "text", text: JSON.stringify(ts, null, 2) }],
    };
  },
);

// --- Resources ---

server.resource("server-info", "toad-eye-mcp-demo://info", async () => ({
  contents: [
    {
      uri: "toad-eye-mcp-demo://info",
      text: JSON.stringify(
        {
          name: "toad-eye-mcp-demo",
          version: "1.0.0",
          tools: ["calculate", "get-weather", "timestamp"],
          observability: "toad-eye middleware active",
        },
        null,
        2,
      ),
    },
  ],
}));

// --- Prompts ---

server.prompt(
  "weather-report",
  "Generate a weather report prompt for a given city",
  { city: z.string().describe("City to report on") },
  async ({ city }) => ({
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `Provide a detailed weather report for ${city}. Include temperature, conditions, and recommendations.`,
        },
      },
    ],
  }),
);

// --- Start ---

const transport = new StdioServerTransport();
await server.connect(transport);

// Log to stderr (stdout is JSON-RPC transport in stdio mode)
console.error("toad-eye MCP demo server running on stdio");
console.error("  Traces → Jaeger:     http://localhost:16686");
console.error("  Metrics → Prometheus: http://localhost:9090");
console.error("  Dashboards → Grafana: http://localhost:3100");
