import type { LLMProvider } from "../types/index.js";

export interface Instrumentation {
  readonly name: LLMProvider;
  /** Try to find and patch the SDK. Returns true if patched, false if SDK not found. */
  enable(): boolean;
  /** Restore original methods. */
  disable(): void;
}

/** Tool call accumulated from streaming chunks. */
export interface AccumulatedToolCall {
  name: string;
  arguments: string;
  id?: string | undefined;
}

/** Accumulated stream data — only primitives, no raw SDK objects. */
export interface StreamAccumulator {
  completion: string;
  /** Anthropic extended thinking content (tracked separately from completion). */
  thinkingContent: string;
  inputTokens: number;
  outputTokens: number;
  toolCalls: AccumulatedToolCall[];
}

/** Describes a single method to monkey-patch on an SDK prototype. */
export interface PatchTarget {
  /** How to find the prototype from the loaded SDK module */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getPrototype: (sdk: any) => any | undefined;
  /** Method name on the prototype to patch */
  method: string;
  /** Extract LLMCallInput fields from the request arguments.
   *  thisArg is the SDK object instance — use it when the model name is not in the request body
   *  (e.g., Gemini's GenerativeModel stores it as this.model). */
  extractRequest: (
    body: unknown,
    thisArg?: unknown,
  ) => {
    prompt: string;
    model: string;
    temperature?: number;
  };
  /** Extract LLMCallOutput fields from the SDK response */
  extractResponse: (
    response: unknown,
    model: string,
  ) => {
    completion: string;
    inputTokens: number;
    outputTokens: number;
  };
  /** Return true if this call should skip patching entirely */
  shouldSkip?: (body: unknown) => boolean;
  /** Return true if this call is a streaming request */
  isStreaming?: (body: unknown) => boolean;
  /** Process one stream chunk — extract only the data we need into the accumulator. */
  accumulateChunk?: (acc: StreamAccumulator, chunk: unknown) => void;
}
