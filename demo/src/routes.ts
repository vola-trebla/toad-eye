import { Hono } from "hono";
import { mockLLMCall } from "./mock-llm.js";

export const routes = new Hono();

routes.post("/chat", async (c) => {
  const body = await c.req.json<{ prompt: string }>();

  try {
    const result = await mockLLMCall(body.prompt);
    return c.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ ok: false, error: message }, 500);
  }
});

routes.get("/health", (c) => {
  return c.json({ status: "ok" });
});
