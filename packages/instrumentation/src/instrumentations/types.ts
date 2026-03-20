import type { LLMProvider } from "../types/index.js";

export interface Instrumentation {
  readonly name: LLMProvider;
  /** Try to find and patch the SDK. Returns true if patched, false if SDK not found. */
  enable(): boolean;
  /** Restore original methods. */
  disable(): void;
}

/** Describes a single method to monkey-patch on an SDK prototype. */
export interface PatchTarget {
  /** How to find the prototype from the loaded SDK module */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getPrototype: (sdk: any) => any | undefined;
  /** Method name on the prototype to patch */
  method: string;
  /** Extract LLMCallInput fields from the request arguments */
  extractRequest: (body: unknown) => {
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
  /** Extract final stats from accumulated stream chunks. Required when isStreaming is set. */
  extractStreamResponse?: (chunks: unknown[]) => {
    completion: string;
    inputTokens: number;
    outputTokens: number;
  };
}
