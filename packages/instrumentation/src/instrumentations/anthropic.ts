import { register } from "./registry.js";
import { createInstrumentation } from "./create.js";
import type { PatchTarget } from "./types.js";

function extractMessages(messages: unknown): string {
  if (!Array.isArray(messages)) return "";
  return messages
    .map((m: { content?: unknown }) => {
      if (typeof m.content === "string") return m.content;
      if (Array.isArray(m.content)) {
        return (m.content as { type?: string; text?: string }[])
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("");
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function extractCompletion(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return (content as { type?: string; text?: string }[])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");
}

const messagesCreate: PatchTarget = {
  getPrototype: (sdk) => sdk?.Messages?.prototype,
  method: "create",
  shouldSkip: (body) => !!(body as { stream?: boolean })?.stream,
  extractRequest: (body) => {
    const b = body as Record<string, unknown>;
    return {
      prompt: extractMessages(b?.messages),
      model: (b?.model as string) ?? "unknown",
      temperature: (b?.temperature as number) ?? 1.0,
    };
  },
  extractResponse: (response) => {
    const r = response as {
      content?: unknown;
      usage?: { input_tokens?: number; output_tokens?: number };
      model?: string;
    };
    return {
      completion: extractCompletion(r?.content),
      inputTokens: r?.usage?.input_tokens ?? 0,
      outputTokens: r?.usage?.output_tokens ?? 0,
    };
  },
};

register(
  createInstrumentation({
    name: "anthropic",
    moduleName: "@anthropic-ai/sdk",
    patches: [messagesCreate],
  }),
);
