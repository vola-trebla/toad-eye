import { createRequire } from "node:module";
import { diag } from "@opentelemetry/api";
import { traceLLMCall } from "../spans.js";
import type { LLMCallOutput } from "../spans.js";
import { register } from "./registry.js";
import type { Instrumentation } from "./types.js";

const require = createRequire(import.meta.url);

let originalGenerateContent: ((...args: unknown[]) => unknown) | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let modelProto: any = null;

function extractPrompt(request: unknown): string {
  if (typeof request === "string") return request;
  if (typeof request === "object" && request !== null) {
    const req = request as { contents?: unknown };
    if (Array.isArray(req.contents)) {
      return (req.contents as { parts?: { text?: string }[] }[])
        .flatMap((c) => c.parts ?? [])
        .map((p) => p.text ?? "")
        .filter(Boolean)
        .join("\n");
    }
  }
  return "";
}

const geminiInstrumentation: Instrumentation = {
  name: "gemini",

  enable() {
    try {
      require.resolve("@google/generative-ai");
    } catch {
      return false;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const sdk = require("@google/generative-ai");
      const GenerativeModel = sdk.GenerativeModel;

      if (!GenerativeModel?.prototype?.generateContent) {
        diag.debug(
          "toad-eye: GenerativeModel.prototype.generateContent not found",
        );
        return false;
      }

      modelProto = GenerativeModel.prototype;
      originalGenerateContent = modelProto.generateContent;

      modelProto.generateContent = function patchedGenerateContent(
        request: unknown,
        ...rest: unknown[]
      ) {
        const prompt = extractPrompt(request);
        // `this.model` contains the model name on GenerativeModel instances
        const model = (this as { model?: string }).model ?? "unknown";

        return traceLLMCall(
          { provider: "gemini", model, prompt },
          async (): Promise<LLMCallOutput> => {
            const result = (await originalGenerateContent!.call(
              this,
              request,
              ...rest,
            )) as {
              response?: {
                text?: () => string;
                usageMetadata?: {
                  promptTokenCount?: number;
                  candidatesTokenCount?: number;
                };
              };
            };

            const response = result?.response;
            let completion = "";
            try {
              completion = response?.text?.() ?? "";
            } catch {
              // text() may throw if response is blocked
            }

            return {
              completion,
              inputTokens: response?.usageMetadata?.promptTokenCount ?? 0,
              outputTokens: response?.usageMetadata?.candidatesTokenCount ?? 0,
              cost: 0,
            };
          },
        );
      };

      return true;
    } catch (err) {
      diag.warn(`toad-eye: failed to patch gemini: ${err}`);
      return false;
    }
  },

  disable() {
    if (modelProto && originalGenerateContent) {
      modelProto.generateContent = originalGenerateContent;
      originalGenerateContent = null;
      modelProto = null;
    }
  },
};

register(geminiInstrumentation);
