import { createRequire } from "node:module";
import { diag } from "@opentelemetry/api";
import { traceLLMCall } from "../spans.js";
import type { LLMCallOutput } from "../spans.js";
import { calculateCost } from "../pricing.js";
import { register } from "./registry.js";
import type { Instrumentation } from "./types.js";

const require = createRequire(import.meta.url);

let originalCreate: ((...args: unknown[]) => unknown) | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let messagesProto: any = null;

function extractPrompt(messages: unknown): string {
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

const anthropicInstrumentation: Instrumentation = {
  name: "anthropic",

  enable() {
    try {
      require.resolve("@anthropic-ai/sdk");
    } catch {
      return false;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const sdk = require("@anthropic-ai/sdk");
      const Anthropic = sdk.default ?? sdk;

      // Anthropic SDK exposes Messages class
      const MessagesClass = Anthropic?.Messages;

      if (!MessagesClass?.prototype?.create) {
        diag.debug("toad-eye: Anthropic Messages.prototype.create not found");
        return false;
      }

      messagesProto = MessagesClass.prototype;
      originalCreate = messagesProto.create;

      messagesProto.create = function patchedCreate(
        body: Record<string, unknown>,
        ...rest: unknown[]
      ) {
        // Skip streaming — passthrough
        if (body?.stream) {
          return originalCreate!.call(this, body, ...rest);
        }

        const prompt = extractPrompt(body?.messages);
        const model = (body?.model as string) ?? "unknown";
        const temperature = (body?.temperature as number) ?? 1.0;

        return traceLLMCall(
          { provider: "anthropic", model, prompt, temperature },
          async (): Promise<LLMCallOutput> => {
            const response = (await originalCreate!.call(
              this,
              body,
              ...rest,
            )) as {
              content?: unknown;
              usage?: {
                input_tokens?: number;
                output_tokens?: number;
              };
              model?: string;
            };

            return {
              completion: extractCompletion(response?.content),
              inputTokens: response?.usage?.input_tokens ?? 0,
              outputTokens: response?.usage?.output_tokens ?? 0,
              cost: calculateCost(
                response?.model ?? model,
                response?.usage?.input_tokens ?? 0,
                response?.usage?.output_tokens ?? 0,
              ),
            };
          },
        );
      };

      return true;
    } catch (err) {
      diag.warn(`toad-eye: failed to patch anthropic: ${err}`);
      return false;
    }
  },

  disable() {
    if (messagesProto && originalCreate) {
      messagesProto.create = originalCreate;
      originalCreate = null;
      messagesProto = null;
    }
  },
};

register(anthropicInstrumentation);
