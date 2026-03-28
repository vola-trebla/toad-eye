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
import { registerDemoTools } from "../mcp-shared/tools.js";
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

registerDemoTools(server);

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
