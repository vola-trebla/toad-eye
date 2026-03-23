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
  operationName: "chat",
  extractRequest(body, thisArg) {
    return {
      prompt: extractPrompt(body),
      model: (thisArg as { model?: string } | undefined)?.model ?? "unknown",
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

const generateContentStream: PatchTarget = {
  getPrototype: (sdk) => sdk?.GenerativeModel?.prototype,
  method: "generateContentStream",
  operationName: "chat",
  extractRequest(body, thisArg) {
    return {
      prompt: extractPrompt(body),
      model: (thisArg as { model?: string } | undefined)?.model ?? "unknown",
    };
  },
  extractResponse: () => ({
    completion: "",
    inputTokens: 0,
    outputTokens: 0,
  }),
  // generateContentStream always returns a stream
  isStreaming: () => true,
  accumulateChunk: (acc, chunk) => {
    // Gemini stream chunks are GenerateContentResponse objects
    const c = chunk as {
      text?: () => string;
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
      };
      candidates?: {
        finishReason?: string;
        content?: {
          parts?: { functionCall?: { name: string; args: unknown } }[];
        };
      }[];
    };
    try {
      const text = c?.text?.();
      if (text) acc.completion += text;
    } catch {
      // text() may throw if content is blocked
    }

    // Gemini function calls in streaming
    const parts = c?.candidates?.[0]?.content?.parts;
    if (parts) {
      for (const part of parts) {
        if (part.functionCall) {
          acc.toolCalls.push({
            name: part.functionCall.name,
            arguments: JSON.stringify(part.functionCall.args ?? {}),
          });
        }
      }
    }

    // Track finish reason (especially SAFETY blocks)
    const finishReason = c?.candidates?.[0]?.finishReason;
    if (finishReason) {
      acc.finishReason = finishReason;
    }

    if (c?.usageMetadata) {
      acc.inputTokens = c.usageMetadata.promptTokenCount ?? acc.inputTokens;
      acc.outputTokens =
        c.usageMetadata.candidatesTokenCount ?? acc.outputTokens;
    }
  },
};

export const geminiInstrumentation = createInstrumentation({
  name: "gemini",
  moduleName: "@google/generative-ai",
  patches: [generateContent, generateContentStream],
});
