import { register } from "./registry.js";
import { createInstrumentation } from "./create.js";
import type { PatchTarget } from "./types.js";

function extractMessages(messages: unknown): string {
  if (!Array.isArray(messages)) return "";
  return messages
    .map((m: { content?: unknown }) =>
      typeof m.content === "string" ? m.content : "",
    )
    .filter(Boolean)
    .join("\n");
}

const chatCompletions: PatchTarget = {
  getPrototype: (sdk) =>
    (sdk?.Chat?.Completions ?? sdk?.Completions)?.prototype,
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
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      model?: string;
    };
    return {
      completion: r?.choices?.[0]?.message?.content ?? "",
      inputTokens: r?.usage?.prompt_tokens ?? 0,
      outputTokens: r?.usage?.completion_tokens ?? 0,
    };
  },
};

const embeddings: PatchTarget = {
  getPrototype: (sdk) => sdk?.Embeddings?.prototype,
  method: "create",
  extractRequest: (body) => {
    const b = body as Record<string, unknown>;
    const input = b?.input;
    const prompt =
      typeof input === "string"
        ? input
        : Array.isArray(input)
          ? (input as string[]).join("\n")
          : "";
    return { prompt, model: (b?.model as string) ?? "unknown" };
  },
  extractResponse: (response) => {
    const r = response as {
      usage?: { prompt_tokens?: number };
    };
    return {
      completion: "[embedding]",
      inputTokens: r?.usage?.prompt_tokens ?? 0,
      outputTokens: 0,
    };
  },
};

register(
  createInstrumentation({
    name: "openai",
    moduleName: "openai",
    patches: [chatCompletions, embeddings],
  }),
);
