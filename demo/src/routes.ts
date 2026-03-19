import { Hono } from "hono";
import { mockLLMCall } from "./mock-llm.js";

export const routes = new Hono();

routes.post("/chat", async (c) => {
  const body = await c.req.json<{ prompt: string }>();

  try {
    const result = await mockLLMCall(body.prompt);
    return c.json({ ok: true, model: "mock", ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ ok: false, error: message }, 500);
  }
});

routes.get("/health", (c) => {
  return c.json({ status: "ok" });
});

routes.get("/", (c) => {
  return c.json({
    name: "toad-eye demo",
    version: "2.0.0",
    endpoints: {
      "POST /chat": "Send { prompt: string } to mock LLM call",
      "GET /health": "Healthcheck",
    },
    stack: {
      grafana: "http://localhost:3100",
      jaeger: "http://localhost:16686",
      prometheus: "http://localhost:9090",
    },
  });
});
