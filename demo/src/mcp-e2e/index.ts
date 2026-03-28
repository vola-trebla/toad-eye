/**
 * End-to-end MCP demo: Client → Server in one trace.
 *
 * Shows distributed tracing across MCP client and server:
 *   Agent span (parent)
 *   ├── tools/call calculate  (CLIENT span)
 *   │   └── tools/call calculate  (SERVER span)
 *   ├── tools/call get-weather  (CLIENT span)
 *   │   └── tools/call get-weather  (SERVER span)
 *   └── tools/call timestamp  (CLIENT span)
 *       └── tools/call timestamp  (SERVER span)
 *
 * Run:  npx tsx demo/src/mcp-e2e/index.ts
 * Requires: npx toad-eye up
 */

import { initObservability, traceAgentQuery, shutdown } from "toad-eye";
import { toadEyeMiddleware } from "toad-eye/mcp";
import { enableMcpClientInstrumentation } from "toad-eye/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";

// Initialize with both server and client instrumentation
initObservability({
  serviceName: "toad-eye-mcp-e2e-demo",
  endpoint: process.env["OTEL_EXPORTER_ENDPOINT"] ?? "http://localhost:4318",
});

// Enable client-side instrumentation (patches Client.prototype)
enableMcpClientInstrumentation();

// --- Create MCP Server with tools ---

const server = new McpServer({
  name: "e2e-demo-server",
  version: "1.0.0",
});

toadEyeMiddleware(server, {
  recordInputs: true,
  recordOutputs: true,
});

server.tool(
  "calculate",
  "Evaluate a math expression",
  { expression: z.string() },
  async ({ expression }) => {
    const sanitized = expression.replace(/[^0-9+\-*/().% ]/g, "");
    const result = new Function(`return (${sanitized})`)() as number;
    return {
      content: [{ type: "text", text: `${expression} = ${result}` }],
    };
  },
);

server.tool(
  "get-weather",
  "Get weather for a city (mock)",
  { city: z.string() },
  async ({ city }) => {
    await new Promise((r) => setTimeout(r, 50 + Math.random() * 150));
    const tempC = Math.round(-10 + Math.random() * 45);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ city, tempC, condition: "sunny" }),
        },
      ],
    };
  },
);

server.tool("timestamp", "Get current timestamp", {}, async () => ({
  content: [{ type: "text", text: new Date().toISOString() }],
}));

// --- Connect Client ↔ Server via InMemoryTransport ---

const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

async function main() {
  console.log("🐸 MCP End-to-End Demo: Client → Server distributed tracing\n");

  // Connect both sides
  const client = new Client({ name: "e2e-demo-client", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  console.log("  ✅ Client ↔ Server connected via InMemoryTransport\n");

  // Wrap all tool calls in an agent span to show the full hierarchy
  const result = await traceAgentQuery(
    {
      query: "Calculate, check weather, and get timestamp",
      agentName: "e2e-demo-agent",
    },
    async (step) => {
      step({ type: "think", stepNumber: 1, content: "Need to run 3 tools" });

      // Tool 1: calculate
      const calc = await client.callTool({
        name: "calculate",
        arguments: { expression: "2 + 2 * 3" },
      });
      const calcText = (calc.content as { type: string; text: string }[])[0]
        ?.text;
      console.log(`  🔧 calculate: ${calcText}`);
      step({
        type: "act",
        stepNumber: 2,
        toolName: "calculate",
        toolType: "function",
      });

      // Tool 2: get-weather
      const weather = await client.callTool({
        name: "get-weather",
        arguments: { city: "Tokyo" },
      });
      const weatherText = (
        weather.content as { type: string; text: string }[]
      )[0]?.text;
      console.log(`  🔧 get-weather: ${weatherText}`);
      step({
        type: "act",
        stepNumber: 3,
        toolName: "get-weather",
        toolType: "function",
      });

      // Tool 3: timestamp
      const ts = await client.callTool({
        name: "timestamp",
        arguments: {},
      });
      const tsText = (ts.content as { type: string; text: string }[])[0]?.text;
      console.log(`  🔧 timestamp: ${tsText}`);
      step({
        type: "act",
        stepNumber: 4,
        toolName: "timestamp",
        toolType: "function",
      });

      step({
        type: "answer",
        stepNumber: 5,
        content: "All 3 tools executed successfully",
      });

      return { answer: "All 3 tools executed successfully" };
    },
  );

  console.log(`\n  Agent result: ${result.answer}`);
  console.log("\n🎯 Check Jaeger (http://localhost:16686):");
  console.log("   Service: toad-eye-mcp-e2e-demo");
  console.log("   Look for: invoke_agent e2e-demo-agent");
  console.log("   Inside:   tools/call calculate (CLIENT → SERVER)");
  console.log("             tools/call get-weather (CLIENT → SERVER)");
  console.log("             tools/call timestamp (CLIENT → SERVER)");

  // Clean up
  await client.close();
  await new Promise((r) => setTimeout(r, 2000));
  await shutdown();
}

main().catch(console.error);
