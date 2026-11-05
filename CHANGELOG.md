# Changelog

## v2.13.0 (2026-11-05)

### Chores

- **OpenTelemetry 3.x** — migrate to `@opentelemetry/sdk-trace` 3.x (replaces deprecated `sdk-trace-base` / `sdk-trace-node`), `sdk-node` 0.301, `sdk-metrics` / `resources` 3.x, `api` 1.10. `BatchSpanProcessor` / `SimpleSpanProcessor` now take `{ exporter }` options. No public API changes.
- **Dependencies** — `@modelcontextprotocol/sdk` 1.32, `openai` 7.x (demo), Vitest 5, Biome 2.6, Prettier 3.9, `@types/node` 26. `@opentelemetry/core` declared as a direct dependency (was transitive).
- **Changelog** — backfill v2.7.0 – v2.12.0.

## v2.12.0 (2026-03-30)

### Refactoring

- **Lifecycle module** — `core/lifecycle.ts` with shared orchestration (budget check, context guard, quality proxies, FinOps attributes). `traceLLMCall()` and `createStreamingHandler()` now call the same functions — closes the duplication flagged in review round 1. (#312, #313, #314)

### Bug Fixes

- **Streaming path** — span ordering, PII redaction, budget release and FinOps attributes diverged from the non-streaming path. (#308–#311)
- **CLI robustness** — review round 3 fixes for `init` / `up` / `status` edge cases.

### Tests

- Coverage for console exporter, tool hallucination metric, thinking tokens. 306 tests total (258 instrumentation + 48 server).

## v2.11.0 (2026-03-29)

### Features

- **Reasoning trace** — `gen_ai.toad_eye.reasoning.*` attributes and span events for thinking models (Anthropic extended thinking, OpenAI o-series). (#39)
- **Light mode** — `initObservability({ exporter: "console" })` prints spans to stdout, no Docker required. (#296)
- **Tool hallucination metric** — MCP `-32601` (method not found) tracked as `gen_ai.mcp.tool.hallucinations`, a distinct signal from ordinary errors. (#295)
- **Port collision detection** — `toad-eye up` checks ports 3100 / 4318 / 9090 / 16686 before starting Docker. (#294)
- **Empty dashboard UX** — no-data messages in panels, post-`up` guidance, auto-open Grafana. (#293)

### Chores

- Biome linter in CI. (#200)
- Dashboard PromQL validation script, `npm run validate:dashboards`, runs in CI. (#203)
- `readmeFilename` in `package.json` — fixes "no README" on npm.

## v2.10.0 (2026-03-29)

### Bug Fixes

- **Review round 2** — `parentSpanId` on nested spans, ESM server auto-instrumentation, array redaction, demo and alerting robustness. (#282–#285)
- **MCP client in ESM** — client instrumentation works in ESM projects. (#282)
- **Grafana PromQL mismatches** — panels that stayed empty due to renamed metrics. (#284)

### Tests

- MCP client instrumentation unit tests. (#286)

## v2.9.0 (2026-03-29)

### Features

- **`onSpanEnd` callback** — `initObservability({ onSpanEnd })` receives structured `SpanEndData` for every LLM / MCP span. Intended as the hook for eval pipelines (toad-eval). (#201)

### Fixes

- v2.9.1 / v2.9.2 — npm README packaging, test count in docs.

## v2.8.0 (2026-03-28)

### Features

- **MCP auto-instrumentation** — `instrument: ["mcp"]` patches the MCP SDK server without `toadEyeMiddleware()`. (#236)
- **MCP client instrumentation** — client-side spans with W3C trace context propagated over MCP `_meta`, giving end-to-end traces across client → server. (#241)
- **MCP tool callers metric** — `gen_ai.mcp.tool.callers` for usage analytics. (#247)
- **Grafana** — MCP End-to-End dashboard (#244), MCP Tool Analytics dashboard with cost attribution (#248, #249).
- **Alerts** — MCP alert rule templates (#245); MCP metrics supported by the alerting engine (#265).
- **Demos** — Streamable HTTP MCP server (#238), end-to-end distributed tracing demo (#243).

### Bug Fixes

- MCP span set as active context in tool / resource / prompt handlers. (#264)
- MCP session lifecycle, deep redaction of nested payloads. (#267, #268)
- Grafana annotation 401 — fallback to Basic Auth. (#246)

### Chores

- MCP SDK version compatibility CI job. (#240)
- MCP DRY cleanup. (#269, #270)

## v2.7.0 (2026-03-28)

### Features

- **MCP semconv alignment** — span names and attributes follow OTel MCP semantic conventions; `mcp.method.name` dimension on MCP metrics. (#232, #233, #234)
- **MCP dashboard** — template variables and tool filter. (#235)
- README rewritten MCP-first.

### Bug Fixes

- OTel Collector template — exporter type `otlphttp` (was `otlp_http`).
- CLI `status` false positive, testing guide missing `shutdown()`.

## v2.6.1 (2026-03-23)

### Fixes

- **npm README** — package README was missing on npm due to prior publish without the file included. No code changes.

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
