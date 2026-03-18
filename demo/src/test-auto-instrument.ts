/**
 * Test script for auto-instrumentation.
 *
 * 1. Starts a fake OpenAI-compatible endpoint on :4444
 * 2. Inits toad-eye with instrument: ['openai']
 * 3. Makes a real OpenAI SDK call pointed at the fake server
 * 4. Span should appear in Jaeger (localhost:16686)
 */

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { initObservability, shutdown } from "toad-eye";

// --- 1. Fake OpenAI-compatible server ---

const fakeOpenAI = new Hono();

fakeOpenAI.post("/v1/chat/completions", async (c) => {
  const body = await c.req.json();
  return c.json({
    id: "chatcmpl-test-123",
    object: "chat.completion",
    created: Date.now(),
    model: body.model ?? "gpt-4o",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: `Mock response for: "${body.messages?.[0]?.content ?? "?"}"`,
        },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: 42,
      completion_tokens: 18,
      total_tokens: 60,
    },
  });
});

const server = serve({ fetch: fakeOpenAI.fetch, port: 4444 }, () => {
  console.log("Fake OpenAI server on http://localhost:4444");
});

// --- 2. Init toad-eye BEFORE importing OpenAI SDK ---

initObservability({
  serviceName: "auto-instrument-test",
  endpoint: "http://localhost:4318",
  instrument: ["openai"],
});

console.log("toad-eye initialized with instrument: ['openai']");

// --- 3. Import OpenAI SDK and make a call ---

const { default: OpenAI } = await import("openai");

const client = new OpenAI({
  apiKey: "fake-key",
  baseURL: "http://localhost:4444/v1",
});

console.log("\nMaking 3 OpenAI SDK calls...\n");

for (let i = 1; i <= 3; i++) {
  const result = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: `Test prompt number ${i}` }],
    temperature: 0.7,
  });
  console.log(`Call ${i}: ${result.choices[0]?.message?.content}`);
}

// --- 4. Cleanup ---

console.log("\nWaiting 6s for metrics export...");
await new Promise((r) => setTimeout(r, 6000));

await shutdown();
server.close();

console.log("\nDone! Check:");
console.log("  Jaeger:      http://localhost:16686");
console.log("  Prometheus:  http://localhost:9090");
console.log('  (search for service "auto-instrument-test")');
