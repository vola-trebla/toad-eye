# toad-eye 🐸👁️

OpenTelemetry-based observability toolkit for LLM systems.

One-line instrumentation for any LLM service — get traces, metrics, and Grafana dashboards out of the box.

## What it does
```
Your LLM service
       ↓ imports
@toad-eye/instrumentation     ← NPM package, one-line init
       ↓ OTLP/HTTP
OTel Collector → Prometheus   ← metrics (cost, latency, tokens)
               → Jaeger       ← traces (full request lifecycle)
               → Grafana      ← dashboards
```

## Quick start
```bash
npm install
cd infra && docker compose up -d   # start observability stack
npm run demo                        # start mock LLM service
# open http://localhost:3000        # Grafana dashboards
```

## Usage
```typescript
import { initObservability } from '@toad-eye/instrumentation';

initObservability({
  serviceName: 'my-llm-service',
  endpoint: 'http://localhost:4318',
});
```

## Project structure
```
packages/instrumentation/   — NPM package (@toad-eye/instrumentation)
demo/                       — mock LLM service for testing
infra/                      — docker-compose stack (OTel + Prometheus + Jaeger + Grafana)
```

## Tech stack

- TypeScript, OpenTelemetry SDK 2.x, OTLP exporters
- Hono (demo server)
- Docker Compose (Prometheus, Jaeger, Grafana, OTel Collector)

## Part of portfolio

Project #7 in [LLM Infrastructure](https://github.com/albertalov/llm-infrastructure) series.

| # | Project | Status |
|---|---------|--------|
| 1 | RAG Ingestion Toolkit | ✅ |
| 2 | Guardrails SDK | ✅ |
| 3 | LLM Eval Framework | ✅ |
| 4 | LLM Gateway | ✅ |
| 5 | Agentic Tool Router | ✅ |
| 6 | Semantic Search Engine | ✅ |
| 7 | **LLM Observability (toad-eye)** | 🔨 |