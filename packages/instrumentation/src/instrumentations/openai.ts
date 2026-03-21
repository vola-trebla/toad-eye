import { createInstrumentation } from "./create.js";
import type { PatchTarget } from "./types.js";

function extractMessages(messages: unknown): string {
  if (!Array.isArray(messages)) return "";
  return messages
    .map((m: { content?: unknown }) => {
      if (typeof m.content === "string") return m.content;
      if (Array.isArray(m.content)) {
        return (m.content as { type?: string; text?: string }[])
          .map((part) => {
            if (part.type === "text") return part.text ?? "";
            if (part.type === "image_url") return "[image]";
            if (part.type === "input_audio") return "[audio]";
            return "";
          })
          .filter(Boolean)
          .join("");
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

const chatCompletions: PatchTarget = {
  getPrototype: (sdk) =>
    (sdk?.Chat?.Completions ?? sdk?.Completions)?.prototype,
  method: "create",
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
  isStreaming: (body) => !!(body as { stream?: boolean })?.stream,
  accumulateChunk: (acc, chunk) => {
    const c = chunk as {
      choices?: { delta?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const delta = c?.choices?.[0]?.delta?.content;
    if (delta) acc.completion += delta;
    if (c?.usage) {
      acc.inputTokens = c.usage.prompt_tokens ?? acc.inputTokens;
      acc.outputTokens = c.usage.completion_tokens ?? acc.outputTokens;
    }
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

export const openaiInstrumentation = createInstrumentation({
  name: "openai",
  moduleName: "openai",
  patches: [chatCompletions, embeddings],
});
