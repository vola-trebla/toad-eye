---
name: key commands
description: Essential commands for development, testing, and observability stack
type: reference
---

## Build & Check

```
npm run build --workspace=packages/instrumentation
npx tsc --noEmit
npm run format:check
```

## Observability Stack (dev, uses infra/ directly)

```
docker compose -f infra/docker-compose.yml up -d
docker compose -f infra/docker-compose.yml down
```

## Observability Stack (as external user, uses templates)

```
npx toad-eye init
npx toad-eye up
npx toad-eye down
npx toad-eye status
```

## Demo & Testing

```
npm run demo                          # start mock LLM server (:3001)
npm run load --workspace=demo         # send traffic every 2s
npm run test:auto --workspace=demo    # test auto-instrumentation
npx toad-eye demo                     # built-in demo (no separate server)
```

## URLs

```
Grafana:        http://localhost:3100  (admin / admin)
Jaeger:         http://localhost:16686
Prometheus:     http://localhost:9090
OTel Collector: http://localhost:4318
Demo server:    http://localhost:3001
```
