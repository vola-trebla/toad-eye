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
  accumulateChunk: (acc, chunk) => {
    const event = chunk as {
      type?: string;
      index?: number;
      message?: { usage?: { input_tokens?: number } };
      content_block?: { type?: string; id?: string; name?: string };
      delta?: {
        type?: string;
        text?: string;
        thinking?: string;
        partial_json?: string;
      };
      usage?: { output_tokens?: number };
    };

    if (event.type === "content_block_delta") {
      if (event.delta?.type === "thinking_delta" && event.delta.thinking) {
        // Extended thinking — track separately from completion
        acc.thinkingContent += event.delta.thinking;
      } else if (event.delta?.text) {
        acc.completion += event.delta.text;
      }
    }

    // Tool use: content_block_start with type "tool_use"
    if (
      event.type === "content_block_start" &&
      event.content_block?.type === "tool_use"
    ) {
      acc.toolCalls.push({
        name: event.content_block.name ?? "",
        arguments: "",
        id: event.content_block.id,
      });
    }

    // Tool use: input_json_delta accumulates arguments
    if (
      event.type === "content_block_delta" &&
      event.delta?.type === "input_json_delta" &&
      event.delta.partial_json
    ) {
      const last = acc.toolCalls[acc.toolCalls.length - 1];
      if (last) last.arguments += event.delta.partial_json;
    }

    if (event.type === "message_start" && event.message?.usage) {
      acc.inputTokens = event.message.usage.input_tokens ?? 0;
    }
    if (event.type === "message_delta" && event.usage) {
      acc.outputTokens = event.usage.output_tokens ?? 0;
    }
  },
};

export const anthropicInstrumentation = createInstrumentation({
  name: "anthropic",
  moduleName: "@anthropic-ai/sdk",
  patches: [messagesCreate],
});
