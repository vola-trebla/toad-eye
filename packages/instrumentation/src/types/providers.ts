/**
 * LLM providers supported by toad-eye.
 * Values follow OTel GenAI semconv `gen_ai.provider.name`.
 */
export type LLMProvider = "anthropic" | "gemini" | "openai" | (string & {});

/**
 * All instrumentable targets — includes LLM providers + framework SDKs.
 * 'ai' = Vercel AI SDK (uses SpanProcessor, not monkey-patching).
 */
export type InstrumentTarget = LLMProvider | "ai";
