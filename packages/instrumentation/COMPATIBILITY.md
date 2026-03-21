# toad-eye Compatibility Matrix

Which observability backends work with toad-eye traces, metrics, and agent spans.

**Last updated:** 2026-03-21 (toad-eye v2.4, OTel GenAI semconv — all experimental)

---

## Backend support

| Backend             | Traces  | Metrics               | GenAI span viz                   | Agent spans          | Events                    | Notes                                                                                                                                 |
| ------------------- | ------- | --------------------- | -------------------------------- | -------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Jaeger**          | Full    | N/A                   | Basic (shows spans + attributes) | Nested spans         | Span logs                 | No GenAI-specific UI. Good for trace exploration.                                                                                     |
| **Grafana + Tempo** | Full    | Full (via Prometheus) | Basic (via Grafana)              | Nested spans         | Span logs                 | Primary recommended setup. 8 dashboards ship with toad-eye.                                                                           |
| **Prometheus**      | N/A     | Full                  | N/A                              | N/A                  | N/A                       | Metrics only. Powers Grafana dashboards.                                                                                              |
| **Arize Phoenix**   | Full    | Partial               | Full GenAI UI                    | Agent workflow viz   | Full                      | Built for GenAI. Expects OTel + OpenInference. See [OpenInference bridge (#123)](https://github.com/vola-trebla/toad-eye/issues/123). |
| **SigNoz**          | Full    | Full                  | GenAI dashboards                 | Nested spans         | Full                      | Has pre-built Vercel AI SDK dashboard.                                                                                                |
| **Datadog**         | Full    | Full                  | LLM Observability product        | Agent tracing        | Full                      | Proprietary mapping from OTel. Requires Datadog OTel Collector config.                                                                |
| **Langfuse**        | Partial | N/A                   | Full GenAI UI                    | Session + trace view | Via LangfuseSpanProcessor | Expects specific attribute mapping (`ai.usage.promptTokens`).                                                                         |
| **Honeycomb**       | Full    | Full                  | Basic                            | Nested spans         | Full                      | Good general OTel support, no GenAI-specific UI.                                                                                      |

---

## Attribute compatibility

### Standard OTel GenAI attributes (all backends)

These attributes are part of the OTel GenAI semantic conventions and indexed by all OTel-compatible backends:

| Attribute                        | toad-eye constant             | Used for                 |
| -------------------------------- | ----------------------------- | ------------------------ |
| `gen_ai.operation.name`          | `GEN_AI_ATTRS.OPERATION`      | Operation type filtering |
| `gen_ai.request.model`           | `GEN_AI_ATTRS.REQUEST_MODEL`  | Model filtering          |
| `gen_ai.provider.name`           | `GEN_AI_ATTRS.PROVIDER`       | Provider filtering       |
| `gen_ai.usage.input_tokens`      | `GEN_AI_ATTRS.INPUT_TOKENS`   | Token tracking           |
| `gen_ai.usage.output_tokens`     | `GEN_AI_ATTRS.OUTPUT_TOKENS`  | Token tracking           |
| `gen_ai.response.finish_reasons` | `GEN_AI_ATTRS.FINISH_REASONS` | Completion status        |
| `error.type`                     | `GEN_AI_ATTRS.ERROR`          | Error filtering          |
| `gen_ai.agent.name`              | `GEN_AI_ATTRS.AGENT_NAME`     | Agent identification     |
| `gen_ai.agent.id`                | `GEN_AI_ATTRS.AGENT_ID`       | Agent identification     |
| `gen_ai.tool.name`               | `GEN_AI_ATTRS.TOOL_NAME`      | Tool identification      |
| `gen_ai.tool.type`               | `GEN_AI_ATTRS.TOOL_TYPE`      | Tool classification      |

### toad-eye extension attributes

These are toad-eye-specific and not part of the OTel spec. Backends store them as custom attributes — queryable but not auto-visualized:

| Attribute                           | toad-eye constant                     | Purpose                     |
| ----------------------------------- | ------------------------------------- | --------------------------- |
| `gen_ai.toad_eye.cost`              | `GEN_AI_ATTRS.COST`                   | Cost in USD                 |
| `gen_ai.toad_eye.prompt`            | `GEN_AI_ATTRS.PROMPT`                 | Prompt content (opt-in)     |
| `gen_ai.toad_eye.completion`        | `GEN_AI_ATTRS.COMPLETION`             | Completion content (opt-in) |
| `gen_ai.toad_eye.agent.step.type`   | `GEN_AI_ATTRS.TOAD_AGENT_STEP_TYPE`   | ReAct step type             |
| `gen_ai.toad_eye.agent.step.number` | `GEN_AI_ATTRS.TOAD_AGENT_STEP_NUMBER` | Step sequence number        |
| `gen_ai.toad_eye.agent.handoff.to`  | `GEN_AI_ATTRS.TOAD_AGENT_HANDOFF_TO`  | Handoff target agent        |
| `gen_ai.toad_eye.agent.loop_count`  | `GEN_AI_ATTRS.TOAD_AGENT_LOOP_COUNT`  | ReAct loop iterations       |
| `gen_ai.toad_eye.guard.*`           | `GEN_AI_ATTRS.GUARD_*`                | toad-guard integration      |

---

## Span naming convention

toad-eye follows the OTel GenAI span naming spec:

| Span type      | Name format                | Example                      |
| -------------- | -------------------------- | ---------------------------- |
| LLM call       | `chat {model}`             | `chat gpt-4o`                |
| Agent query    | `invoke_agent {agentName}` | `invoke_agent space-monitor` |
| Tool execution | `execute_tool {toolName}`  | `execute_tool web-search`    |
| Agent step     | `gen_ai.agent.step.{type}` | `gen_ai.agent.step.think`    |

---

## OTEL_SEMCONV_STABILITY_OPT_IN

toad-eye respects the standard OTel env var for controlling semconv attribute emission:

```bash
# Default: emit both new (gen_ai.toad_eye.*) and deprecated (gen_ai.agent.*) attributes
# No env var needed

# Latest experimental: emit only new canonical attributes (skip deprecated aliases)
export OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental
```

When `gen_ai_latest_experimental` is in the comma-separated list, deprecated attribute aliases (e.g. `gen_ai.agent.step.type`) are **not emitted**. Only the canonical `gen_ai.toad_eye.agent.*` and OTel standard `gen_ai.*` attributes are recorded.

This env var is evaluated at span creation time, not at init.

---

## Recommended setup

For most teams, the built-in stack is the fastest path:

```bash
npx toad-eye init   # scaffold docker-compose + dashboards
npx toad-eye up     # start Jaeger + Prometheus + Grafana + OTel Collector
```

This gives you:

- **Grafana** (localhost:3100) — 8 pre-built dashboards for LLM metrics
- **Jaeger** (localhost:16686) — trace exploration with full span detail
- **Prometheus** (localhost:9090) — raw metrics for custom queries

For production, replace with your preferred backend (Datadog, SigNoz, etc.) by pointing `endpoint` in `initObservability()` to your OTel Collector.
