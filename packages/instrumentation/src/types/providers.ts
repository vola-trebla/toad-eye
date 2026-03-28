/**
 * LLM providers supported by toad-eye.
 * Values follow OTel GenAI semconv `gen_ai.provider.name`.
 */
export type LLMProvider = "anthropic" | "gemini" | "openai" | (string & {});

/**
 * All instrumentable targets — includes LLM providers + framework SDKs.
 * 'ai' = Vercel AI SDK (uses SpanProcessor, not monkey-patching).
 * 'mcp' = MCP SDK McpServer (patches prototype for auto-instrumentation).
 * 'mcp-client' = MCP SDK Client (patches callTool/readResource/getPrompt for distributed tracing).
 */
export type InstrumentTarget = LLMProvider | "ai" | "mcp" | "mcp-client";
