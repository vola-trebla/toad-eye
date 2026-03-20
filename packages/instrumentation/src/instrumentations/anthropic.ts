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
  isStreaming: (body) => !!(body as { stream?: boolean })?.stream,
  extractStreamResponse: (chunks) => {
    // Anthropic stream events: message_start, content_block_delta, message_delta, message_stop
    let completion = "";
    let inputTokens = 0;
    let outputTokens = 0;

    for (const chunk of chunks) {
      const event = chunk as {
        type?: string;
        message?: { usage?: { input_tokens?: number } };
        delta?: { text?: string; usage?: { output_tokens?: number } };
        usage?: { output_tokens?: number };
      };
      if (event.type === "content_block_delta" && event.delta?.text) {
        completion += event.delta.text;
      }
      if (event.type === "message_start" && event.message?.usage) {
        inputTokens = event.message.usage.input_tokens ?? 0;
      }
      if (event.type === "message_delta" && event.usage) {
        outputTokens = event.usage.output_tokens ?? 0;
      }
    }

    return { completion, inputTokens, outputTokens };
  },
};

register(
  createInstrumentation({
    name: "anthropic",
    moduleName: "@anthropic-ai/sdk",
    patches: [messagesCreate],
  }),
);
