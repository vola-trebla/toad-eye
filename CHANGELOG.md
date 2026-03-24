# Changelog

## v2.6.0 (2026-03-23)

### Features

- **MCP Server Middleware** — `toadEyeMiddleware(server)` one-line instrumentation for MCP servers. Wraps `tools/call`, `resources/read`, `prompts/get` with OTel spans following GenAI semconv. Privacy-first: `recordInputs/recordOutputs` off by default, key redaction, payload truncation. (#125, #209, #210, #211)
- **MCP STDIO safety** — `ensureStdioSafe()` redirects OTel diagnostics to stderr, preventing stdout pollution that crashes stdio MCP transport. (#211)
- **MCP metrics** — `gen_ai.mcp.tool.duration` (histogram), `gen_ai.mcp.tool.calls` (counter), `gen_ai.mcp.tool.errors` (counter), `gen_ai.mcp.resource.reads` (counter), `gen_ai.mcp.session.active` (UpDownCounter). Registered in `GEN_AI_METRICS`. (#210, #215)
- **`traceSampling()`** — wrapper for MCP `sampling/createMessage` (server → client LLM) tracing. Creates `chat {model}` spans with `SpanKind.CLIENT`. (#215)
- **MCP Grafana dashboard** — 9 panels: tool call rate, duration p50/p95, errors by type, resource reads, performance table. Auto-provisioned via `toad-eye init`. (#215)
- **MCP demo server** — `demo/src/mcp-server/index.ts` with 3 tools, 1 resource, 1 prompt. Connect via MCP Inspector. (#215)

### Bug Fixes

- **MCP `error.type` attribute** — was set to error message, now correctly uses error class name per OTel semconv. (#220)
- **OpenAI streaming sparse array** — tool_calls with non-contiguous indices no longer create sparse arrays. (#220)
- **Partial patch cleanup** — `createInstrumentation().enable()` now cleans up applied patches if a later patch throws. (#220)
- **Budget error double-count** — `ToadBudgetExceededError` no longer increments `gen_ai.client.errors`. Budget blocks record only `gen_ai.toad_eye.budget.blocked`. (#222)
- **`warnedModels` memory leak** — Set capped at 100 entries to prevent unbounded growth with dynamic model names. (#222)
- **`downgradeCallback` validation** — throw at init when `onBudgetExceeded: "downgrade"` but callback not provided. (#221)
- **`enableAll()` error handling** — auto-instrumentation failures now emit console warning instead of silent swallow. (#221)
- **`redactPatterns` crash** — invalid user regex no longer crashes all tracing; logs warning and continues. (#221)
- **CLI `--jaeger-url`** — validated with `URL` constructor before use. (#221)

### Breaking Changes

- **`blockAt` → `alertAt`** in `contextGuard` config. The old `blockAt` was dead code that never actually blocked — renamed to match real behavior (warn + metric + span event). (#198)
- **`ToadContextExceededError` removed** from public API. Was never thrown in production code. (#198)
- **`checkContextGuard()` removed** — dead code, never called. Pre-call blocking requires tokenizer dependency that doesn't fit observability scope. (#198)

### Chores

- Remove `claude-code-review.yml` workflow (redundant, slow, broke on PR)
- CI: `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` in Claude workflow
- Pin Docker image versions in templates (#199)

## v2.5.0 (2026-03-22)

### Features

- **Context window utilization** — new metric `gen_ai.toad_eye.context_utilization` (0.0–1.0 ratio of input tokens to model's max context). Span attribute + Prometheus histogram. Tracks how close agent loops get to context limits. (#188)
- **Context guard** — `contextGuard: { warnAt: 0.8, blockAt: 0.95 }` config. Warns or alerts when context utilization exceeds thresholds. New metric `gen_ai.toad_eye.context.blocked`, span event `gen_ai.context.limit_exceeded`. (#190)
- **Tool usage analytics** — `toolDurationMs` and `toolStatus` fields on agent act steps. Per-tool duration histogram `gen_ai.agent.tool_duration` + success/error label on tool usage counter. (#38)
- **Anthropic extended thinking** — track `thinking_delta` chunks separately from completion in streaming. Span attribute `gen_ai.toad_eye.thinking.content_length`. (#182)
- **Service filter in Grafana** — `$service` dropdown in all 8 dashboards. Filter by `job` label when multiple services share one Collector. (#178)
- **`maxContextTokens` in pricing table** — all 15 built-in models now include context window size (GPT-4o: 128K, Claude: 200K, Gemini: 1M). Custom pricing via `setCustomPricing()` supports it too. (#188)

## v2.4.5 (2026-03-22)

### Bug Fixes

- **OpenAI streaming tokens** — auto-inject `stream_options: { include_usage: true }` so token counts are available in streaming responses. (#179)
- **Streaming tool calls** — accumulate tool call chunks for OpenAI, Anthropic, Gemini. Record `gen_ai.tool.name` and `gen_ai.tool.call.count` on streaming spans. (#180)
- **TTFT span event** — add `gen_ai.content.first_token` event + `gen_ai.response.time_to_first_token_ms` attribute + prefill/decode latency split. (#181)

## v2.4.3 (2026-03-21)

### Bug Fixes

- **npx CLI silent** — symlink path mismatch in entry guard. `realpathSync()` fix. (#175)
- **Package exports** — add `"default"` condition for CJS/tsx resolution. (#176)
- **OTel Collector template** — update deprecated exporter aliases, set tail sampling to 100% for local dev. (#177)

## v2.4.2 (2026-03-21)

### Bug Fixes

- **Traces never exported** — empty `spanProcessors: []` suppressed default `BatchSpanProcessor`. One-line fix.
- **`instrument: ['ai']` trace export** — `ToadEyeAISpanProcessor` alone didn't export spans. Added explicit `BatchSpanProcessor`.

## v2.4.0 (2026-03-21)

### Features

- **OTel GenAI semconv alignment** — span names `chat {model}`, `invoke_agent {name}`, `execute_tool {tool}`. New attributes: `gen_ai.agent.name`, `gen_ai.agent.id`, `gen_ai.tool.type`. Dual-emit deprecated aliases with `OTEL_SEMCONV_STABILITY_OPT_IN` env var. (#128, #166-#169)

## v2.3.0 (2026-03-21)

### Features

- **Subpath exports** — `toad-eye/alerts`, `toad-eye/drift`, `toad-eye/export`, `toad-eye/vercel`
- **Auto-calculate cost** — `LLMCallOutput.cost` optional, calculated from model pricing if omitted
- **`LLMProvider` widened** — accepts custom provider strings
- **Lazy provider loading** — provider modules loaded only when `enableAll()` called

### Bug Fixes

- Full technical audit: 24 issues fixed (PII leak, CLI injection, streaming gaps, budget race condition, singleton lifecycle, alerting, dependencies)
- Full DX audit: 20 issues fixed (silent failures, Docker prereq, empty dashboards, CLI polish)
