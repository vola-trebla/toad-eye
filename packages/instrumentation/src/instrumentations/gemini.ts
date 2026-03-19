import { register } from "./registry.js";
import { createInstrumentation } from "./create.js";
import type { PatchTarget } from "./types.js";

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

const generateContent: PatchTarget = {
  getPrototype: (sdk) => sdk?.GenerativeModel?.prototype,
  method: "generateContent",
  extractRequest(body) {
    return {
      prompt: extractPrompt(body),
      // model comes from `this.model` — injected by create.ts via the patched function's `this`
      model: "unknown",
    };
  },
  extractResponse: (response) => {
    const r = response as {
      response?: {
        text?: () => string;
        usageMetadata?: {
          promptTokenCount?: number;
          candidatesTokenCount?: number;
        };
      };
    };
    let completion = "";
    try {
      completion = r?.response?.text?.() ?? "";
    } catch {
      // text() may throw if response is blocked
    }
    return {
      completion,
      inputTokens: r?.response?.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: r?.response?.usageMetadata?.candidatesTokenCount ?? 0,
    };
  },
};

register(
  createInstrumentation({
    name: "gemini",
    moduleName: "@google/generative-ai",
    patches: [generateContent],
  }),
);
