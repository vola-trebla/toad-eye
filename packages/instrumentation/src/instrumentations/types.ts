import type { LLMProvider } from "../types.js";

export interface Instrumentation {
  readonly name: LLMProvider;
  /** Try to find and patch the SDK. Returns true if patched, false if SDK not found. */
  enable(): boolean;
  /** Restore original methods. */
  disable(): void;
}

/** Data extracted from an LLM SDK response */
export interface ExtractedLLMResponse {
  readonly completion: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly model: string;
}
