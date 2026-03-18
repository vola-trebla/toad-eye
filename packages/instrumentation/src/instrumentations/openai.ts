import { createRequire } from "node:module";
import { diag } from "@opentelemetry/api";
import { traceLLMCall } from "../spans.js";
import type { LLMCallOutput } from "../spans.js";
import { register } from "./registry.js";
import type { Instrumentation } from "./types.js";

const require = createRequire(import.meta.url);

let originalChatCreate: ((...args: unknown[]) => unknown) | null = null;
let originalEmbeddingsCreate: ((...args: unknown[]) => unknown) | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let chatProto: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let embeddingsProto: any = null;

function extractPrompt(messages: unknown): string {
  if (!Array.isArray(messages)) return "";
  return messages
    .map((m: { content?: unknown }) => {
      if (typeof m.content === "string") return m.content;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

const openaiInstrumentation: Instrumentation = {
  name: "openai",

  enable() {
    try {
      require.resolve("openai");
    } catch {
      return false;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const sdk = require("openai");
      const OpenAI = sdk.default ?? sdk;

      // Access resource class prototypes
      // OpenAI SDK v4+ exposes: OpenAI.Chat.Completions, OpenAI.Embeddings
      const CompletionsClass = OpenAI?.Chat?.Completions ?? OpenAI?.Completions;
      const EmbeddingsClass = OpenAI?.Embeddings;

      if (CompletionsClass?.prototype?.create) {
        chatProto = CompletionsClass.prototype;
        originalChatCreate = chatProto.create;
        chatProto.create = function patchedChatCreate(
          body: Record<string, unknown>,
          ...rest: unknown[]
        ) {
          // Skip streaming — passthrough
          if (body?.stream) {
            return originalChatCreate!.call(this, body, ...rest);
          }

          const prompt = extractPrompt(body?.messages);
          const model = (body?.model as string) ?? "unknown";
          const temperature = (body?.temperature as number) ?? 1.0;

          return traceLLMCall(
            { provider: "openai", model, prompt, temperature },
            async (): Promise<LLMCallOutput> => {
              const response = (await originalChatCreate!.call(
                this,
                body,
                ...rest,
              )) as {
                choices?: { message?: { content?: string } }[];
                usage?: {
                  prompt_tokens?: number;
                  completion_tokens?: number;
                };
                model?: string;
              };

              return {
                completion: response?.choices?.[0]?.message?.content ?? "",
                inputTokens: response?.usage?.prompt_tokens ?? 0,
                outputTokens: response?.usage?.completion_tokens ?? 0,
                cost: 0,
              };
            },
          );
        };
      }

      if (EmbeddingsClass?.prototype?.create) {
        embeddingsProto = EmbeddingsClass.prototype;
        originalEmbeddingsCreate = embeddingsProto.create;
        embeddingsProto.create = function patchedEmbeddingsCreate(
          body: Record<string, unknown>,
          ...rest: unknown[]
        ) {
          const input = body?.input;
          const prompt =
            typeof input === "string"
              ? input
              : Array.isArray(input)
                ? (input as string[]).join("\n")
                : "";
          const model = (body?.model as string) ?? "unknown";

          return traceLLMCall(
            { provider: "openai", model, prompt },
            async (): Promise<LLMCallOutput> => {
              const response = (await originalEmbeddingsCreate!.call(
                this,
                body,
                ...rest,
              )) as {
                usage?: { prompt_tokens?: number; total_tokens?: number };
                model?: string;
              };

              return {
                completion: "[embedding]",
                inputTokens: response?.usage?.prompt_tokens ?? 0,
                outputTokens: 0,
                cost: 0,
              };
            },
          );
        };
      }

      return !!(originalChatCreate || originalEmbeddingsCreate);
    } catch (err) {
      diag.warn(`toad-eye: failed to patch openai: ${err}`);
      return false;
    }
  },

  disable() {
    if (chatProto && originalChatCreate) {
      chatProto.create = originalChatCreate;
      originalChatCreate = null;
      chatProto = null;
    }
    if (embeddingsProto && originalEmbeddingsCreate) {
      embeddingsProto.create = originalEmbeddingsCreate;
      originalEmbeddingsCreate = null;
      embeddingsProto = null;
    }
  },
};

register(openaiInstrumentation);
