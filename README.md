# toad-eye 🐸👁️

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![OpenTelemetry](https://img.shields.io/badge/OpenTelemetry-000000?logo=opentelemetry&logoColor=white)
![Hono](https://img.shields.io/badge/Hono-E36002?logo=hono&logoColor=white)
![Prometheus](https://img.shields.io/badge/Prometheus-E6522C?logo=prometheus&logoColor=white)
![Grafana](https://img.shields.io/badge/Grafana-F46800?logo=grafana&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?logo=docker&logoColor=white)
![npm](https://img.shields.io/npm/v/toad-eye?color=CB3837&logo=npm&logoColor=white)
![CI](https://github.com/vola-trebla/toad-eye/actions/workflows/ci.yml/badge.svg)
![License](https://img.shields.io/badge/License-ISC-blue)

OpenTelemetry-based observability toolkit for LLM systems.

One-line instrumentation for any LLM service — get traces, metrics, and Grafana dashboards out of the box.

## Why toad-eye?

LLM APIs are black boxes — you don't know what they cost, how slow they are, or why they fail. toad-eye gives you full visibility with one line of code.

## Architecture

```mermaid
flowchart LR
    App["🔮 Your LLM service"]
    Inst["🐸 toad-eye"]
    Coll["📡 OTel Collector"]
    Prom["📊 Prometheus"]
    Jaeger["🔍 Jaeger"]
    Graf["📈 Grafana"]

    App --> Inst --> Coll
    Coll --> Prom --> Graf
    Coll --> Jaeger

    style App fill:#4a5568,stroke:#718096,color:#fff
    style Inst fill:#2d6a4f,stroke:#40916c,color:#fff
    style Coll fill:#1d4ed8,stroke:#3b82f6,color:#fff
    style Prom fill:#e24d1e,stroke:#ff6633,color:#fff
    style Jaeger fill:#00bcd4,stroke:#26c6da,color:#fff
    style Graf fill:#f46800,stroke:#ff8c00,color:#fff
```

## Quick start

```bash
npm install
cd infra && docker compose up -d   # start observability stack
npm run demo                        # start mock LLM service
npm run load --workspace=demo       # send test traffic
```

| Service        | URL                                       |
| -------------- | ----------------------------------------- |
| Grafana        | [localhost:3000](http://localhost:3000)   |
| Jaeger UI      | [localhost:16686](http://localhost:16686) |
| Prometheus     | [localhost:9090](http://localhost:9090)   |
| OTel Collector | [localhost:4318](http://localhost:4318)   |

## Usage

```typescript
import { initObservability, traceLLMCall } from "toad-eye";

// one-line init
initObservability({
  serviceName: "my-llm-service",
  endpoint: "http://localhost:4318",
});

// wrap any LLM call
const result = await traceLLMCall(
  { provider: "anthropic", model: "claude-sonnet-4-20250514", prompt: "hello" },
  () => callYourLLM(),
);
```

> **Privacy mode:** pass `recordContent: false` to `initObservability()` to stop recording prompt/completion text in spans. Useful in production when prompts contain sensitive data.

## What it tracks

### Metrics

| Metric                 | Type      | Description                            |
| ---------------------- | --------- | -------------------------------------- |
| `llm.request.duration` | Histogram | Request latency in milliseconds        |
| `llm.request.cost`     | Histogram | Cost per request in USD                |
| `llm.tokens`           | Counter   | Total tokens consumed (input + output) |
| `llm.requests`         | Counter   | Total requests made                    |
| `llm.errors`           | Counter   | Total failed requests                  |

All metrics are labeled with `provider` and `model` for filtering and grouping.

### Span attributes

| Attribute           | Type   | Description                     |
| ------------------- | ------ | ------------------------------- |
| `llm.provider`      | string | `anthropic`, `gemini`, `openai` |
| `llm.model`         | string | Model identifier                |
| `llm.prompt`        | string | Prompt sent to the LLM          |
| `llm.completion`    | string | Response from the LLM           |
| `llm.input_tokens`  | number | Tokens in the prompt            |
| `llm.output_tokens` | number | Tokens in the completion        |
| `llm.cost`          | number | Cost in USD                     |
| `llm.temperature`   | number | Temperature parameter           |
| `llm.status`        | string | `success` or `error`            |
| `llm.error`         | string | Error message (if failed)       |

## Grafana dashboard

![toad-eye Grafana dashboard](demo/grafana-dashboard.png)

## Jaeger traces

![toad-eye Jaeger traces](demo/jaeger-traces.png)

## Project structure

```
packages/instrumentation/   — NPM package (toad-eye)
demo/                       — mock LLM service for testing
infra/                      — docker-compose stack (OTel + Prometheus + Jaeger + Grafana)
```

## Tech stack

- TypeScript, OpenTelemetry SDK 2.x, OTLP exporters
- Hono (demo server)
- Docker Compose (Prometheus, Jaeger, Grafana, OTel Collector)
