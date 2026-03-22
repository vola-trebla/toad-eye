# Changelog

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
