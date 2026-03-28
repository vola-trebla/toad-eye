/**
 * Shared demo tools — used by stdio, HTTP, and E2E demos.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerDemoTools(server: McpServer) {
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
}
