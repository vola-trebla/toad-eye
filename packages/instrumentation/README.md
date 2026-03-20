# toad-eye

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![OpenTelemetry](https://img.shields.io/badge/OpenTelemetry-000000?logo=opentelemetry&logoColor=white)
![Hono](https://img.shields.io/badge/Hono-E36002?logo=hono&logoColor=white)
![Prometheus](https://img.shields.io/badge/Prometheus-E6522C?logo=prometheus&logoColor=white)
![Grafana](https://img.shields.io/badge/Grafana-F46800?logo=grafana&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?logo=docker&logoColor=white)
[![npm](https://img.shields.io/npm/v/toad-eye?color=CB3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/toad-eye)
![CI](https://github.com/vola-trebla/toad-eye/actions/workflows/ci.yml/badge.svg)
![License](https://img.shields.io/badge/License-ISC-blue)

OpenTelemetry-based observability toolkit for LLM systems.

Auto-instrument any LLM SDK (including streaming), get traces, metrics, cost tracking, budget guards, agent observability, guardrail monitoring, and 6 Grafana dashboards out of the box. Self-hosted or cloud mode.

![toad-eye demo](https://raw.githubusercontent.com/vola-trebla/toad-eye/main/demo/toad-eye-demo-gifski.gif)

## Quick start

```bash
npm install toad-eye
npx toad-eye init       # scaffold observability stack
npx toad-eye up         # start Grafana + Prometheus + Jaeger
npx toad-eye demo       # send mock LLM traffic, see data immediately
```

Open [localhost:3100](http://localhost:3100) (Grafana, admin/admin) to see your dashboards.

### Cloud mode

No Docker needed. Send telemetry to toad-eye cloud with one line:

```typescript
initObservability({
  serviceName: "my-app",
  apiKey: "toad_xxxxxxxx",
  instrument: ["openai"],
});
```

Self-hosted mode remains the default. Cloud mode activates automatically when `apiKey` is set.

## Auto-instrumentation

Zero-code instrumentation for popular LLM SDKs. No wrappers needed.

```typescript
import { initObservability } from "toad-eye";

initObservability({
  serviceName: "my-app",
  instrument: ["openai", "anthropic"],
});

// That's it. Every SDK call is auto-traced.
const result = await openai.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Hello" }],
});
```

**Supported SDKs:** OpenAI (`openai`), Anthropic (`@anthropic-ai/sdk`), Google GenAI (`@google/generative-ai`)

Both regular and **streaming** calls are fully instrumented — spans, metrics, and cost tracking work transparently for `stream: true`.

### Manual instrumentation

For custom providers or fine-grained control:

```typescript
import { initObservability, traceLLMCall } from "toad-eye";

initObservability({ serviceName: "my-app" });

const result = await traceLLMCall(
  { provider: "anthropic", model: "claude-sonnet-4-20250514", prompt: "hello" },
  () => callYourLLM(),
);
```

## Agent observability

Structured tracing for ReAct agents (think / act / observe / answer) as nested OpenTelemetry spans.

```typescript
import { traceAgentQuery } from "toad-eye";

const result = await traceAgentQuery(
  "Is anything dangerous near Earth?",
  async (step) => {
    step({
      type: "think",
      stepNumber: 1,
      content: "I need to check asteroids",
    });
    const data = await callTool("near-earth-asteroids");
    step({ type: "act", stepNumber: 2, toolName: "near-earth-asteroids" });
    step({
      type: "observe",
      stepNumber: 3,
      content: `${data.length} asteroids found`,
    });
    step({
      type: "answer",
      stepNumber: 4,
      content: "7 asteroids passing safely",
    });
    return { answer: "7 asteroids passing safely" };
  },
);
```

Metrics: steps per query (histogram), tool usage frequency (counter per tool name).

## Shadow guardrails

Validate LLM responses without blocking them. Record what _would_ have been blocked, then decide when to enforce.

```typescript
import { recordGuardResult } from "toad-eye";

// toad-guard validates, toad-eye records
const result = guard.validate(response);
recordGuardResult({
  mode: "shadow",
  passed: false,
  ruleName: "pii_filter",
  failureReason: "SSN detected in response",
});
```

Metrics: `guard.evaluations` (total checks), `guard.would_block` (would-have-blocked count) per rule name.

## Semantic drift monitoring

Detect silent LLM quality degradation by comparing current responses to a saved baseline via embeddings.

```typescript
import { createDriftMonitor, saveBaseline } from "toad-eye";

const monitor = createDriftMonitor({
  embedding: { provider: "openai", apiKey: process.env.OPENAI_API_KEY! },
  baselinePath: "./baseline.json",
  sampleRate: 10, // check every 10th response
});

// In your LLM call handler:
const drift = await monitor.check(response, "openai", "gpt-4o");
// drift = 0 → identical to baseline
// drift > 0.3 → significant deviation
```

## Trace-to-dataset export

Convert production Jaeger traces into test cases. Production failure becomes a regression test.

```bash
npx toad-eye export-trace <trace_id> --output ./evals/
```

Generates YAML in toad-eval format with auto-generated assertions (max length, refusal detection, JSON validation).

## Features

### Built-in cost tracking

Automatic cost calculation for major models (GPT-4o, Claude, Gemini) based on token usage. Custom pricing for enterprise contracts:

```typescript
import { setCustomPricing } from "toad-eye";

setCustomPricing({
  "my-fine-tuned-model": { inputPer1M: 5, outputPer1M: 15 },
});
```

### Privacy controls

```typescript
initObservability({
  serviceName: "my-app",
  recordContent: false, // disable prompt/completion recording
  hashContent: true, // SHA-256 hash instead of plain text
  redactPatterns: [/\b\S+@\S+\.\S+\b/g], // regex redaction
});
```

### Session tracking

Group traces by conversation session:

```typescript
initObservability({
  serviceName: "my-app",
  sessionId: "static-session-id",
  // or dynamic:
  sessionExtractor: () => getCurrentSessionId(),
});
```

### Alerting

Cost spikes, latency anomalies, error rate monitoring via YAML config:

```yaml
alerts:
  - name: cost_spike
    metric: gen_ai.client.request.cost
    condition: sum_1h > 10
    channels: [slack]

  - name: latency_anomaly
    metric: gen_ai.client.operation.duration
    condition: p95_pct_5m_7d > 50
    channels: [slack]

  - name: error_rate
    metric: gen_ai.client.errors
    condition: ratio_15m > 0.05
    channels: [slack]
```

Delivery channels: Telegram, Slack webhook, generic HTTP webhook, email (SMTP).

### Budget guards

Prevent cost overruns at runtime. Three modes: warn, block, or auto-downgrade to a cheaper model.

```typescript
initObservability({
  serviceName: "my-app",
  budgets: {
    daily: 50, // $50/day max
    perUser: 5, // $5/day per user
    perModel: { "gpt-4o": 30 }, // $30/day on GPT-4o
  },
  onBudgetExceeded: "block", // throws ToadBudgetExceededError
});
```

| Mode        | Behavior                                            |
| ----------- | --------------------------------------------------- |
| `warn`      | Log warning, continue normally                      |
| `block`     | Throw `ToadBudgetExceededError` before LLM call     |
| `downgrade` | Call `downgradeCallback` to switch to cheaper model |

## FinOps attribution

Track costs by team, user, feature, or any business dimension:

```typescript
// Global attributes — applied to all spans/metrics
initObservability({
  serviceName: "my-app",
  attributes: { team: "checkout", environment: "production" },
});

// Per-request attributes — override or extend global
await traceLLMCall(
  {
    provider: "openai",
    model: "gpt-4o",
    prompt: "Summarize order",
    attributes: { userId: "user-123", feature: "order-summary" },
  },
  () => callLLM(),
);
```

## Grafana dashboards

6 pre-built dashboards auto-provisioned on `npx toad-eye init`:

| Dashboard              | What it shows                                             |
| ---------------------- | --------------------------------------------------------- |
| **Overview**           | Request rate, error rate, latency p50/p95, cost, totals   |
| **Cost Breakdown**     | Spend by provider/model, daily trend, projected monthly   |
| **Latency Analysis**   | p50/p95/p99 by model, distribution histogram              |
| **Error Drill-down**   | Error rate by provider/model, error vs success            |
| **Model Comparison**   | Latency vs cost vs error rate vs throughput per model     |
| **FinOps Attribution** | Cost by team/user/feature, projected spend, what-if table |

All dashboards have template variables for filtering (`$provider`, `$model`, `$team`, `$feature`).

## CLI

| Command                          | Description                                     |
| -------------------------------- | ----------------------------------------------- |
| `npx toad-eye init`              | Scaffold Docker Compose + observability configs |
| `npx toad-eye up`                | Start the stack                                 |
| `npx toad-eye down`              | Stop the stack                                  |
| `npx toad-eye status`            | Show running services and URLs                  |
| `npx toad-eye demo`              | Send mock LLM traffic to see data in Grafana    |
| `npx toad-eye export-trace <id>` | Export a Jaeger trace to toad-eval YAML         |

## Architecture

![toad-eye architecture](https://raw.githubusercontent.com/vola-trebla/toad-eye/main/demo/toad_eye_architecture.svg)

## What it tracks

### Metrics (OTel GenAI semconv)

| Metric                              | Type      | Description                         |
| ----------------------------------- | --------- | ----------------------------------- |
| `gen_ai.client.operation.duration`  | Histogram | Request latency (ms)                |
| `gen_ai.client.request.cost`        | Histogram | Cost per request (USD)              |
| `gen_ai.client.token.usage`         | Counter   | Total tokens consumed               |
| `gen_ai.client.requests`            | Counter   | Total requests                      |
| `gen_ai.client.errors`              | Counter   | Total failed requests               |
| `gen_ai.agent.steps_per_query`      | Histogram | Agent steps per query               |
| `gen_ai.agent.tool_usage`           | Counter   | Agent tool invocations by tool name |
| `gen_ai.toad_eye.guard.evaluations` | Counter   | Guard evaluations per rule          |
| `gen_ai.toad_eye.guard.would_block` | Counter   | Would-have-blocked per rule         |
| `gen_ai.toad_eye.semantic_drift`    | Histogram | Semantic drift from baseline (0..1) |
| `gen_ai.toad_eye.budget.exceeded`   | Counter   | Budget limit exceeded events        |
| `gen_ai.toad_eye.budget.blocked`    | Counter   | LLM calls blocked by budget         |
| `gen_ai.toad_eye.budget.downgraded` | Counter   | LLM calls downgraded by budget      |

All metrics labeled with `gen_ai.provider.name` and `gen_ai.request.model`.

### Span attributes

| Attribute                    | Description                          |
| ---------------------------- | ------------------------------------ |
| `gen_ai.provider.name`       | `anthropic`, `gemini`, `openai`      |
| `gen_ai.request.model`       | Model identifier                     |
| `gen_ai.usage.input_tokens`  | Tokens in the prompt                 |
| `gen_ai.usage.output_tokens` | Tokens in the completion             |
| `gen_ai.request.temperature` | Temperature parameter                |
| `gen_ai.toad_eye.cost`       | Cost in USD                          |
| `gen_ai.agent.step.type`     | Agent step: think/act/observe/answer |
| `gen_ai.agent.tool.name`     | Tool name for agent act steps        |
| `gen_ai.toad_eye.guard.mode` | Guard mode: shadow/enforce           |
| `session.id`                 | Session identifier (if configured)   |

## Services

| Service        | URL                                                     |
| -------------- | ------------------------------------------------------- |
| Grafana        | [localhost:3100](http://localhost:3100) (admin / admin) |
| Jaeger UI      | [localhost:16686](http://localhost:16686)               |
| Prometheus     | [localhost:9090](http://localhost:9090)                 |
| OTel Collector | [localhost:4318](http://localhost:4318)                 |

## Tech stack

- TypeScript, OpenTelemetry SDK 2.x, OTel GenAI semantic conventions
- Hono (demo server + cloud ingestion server)
- Docker Compose (Prometheus, Jaeger, Grafana, OTel Collector)
- Vitest (154 tests)
