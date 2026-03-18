# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**toad-eye** — OpenTelemetry-based observability toolkit for LLM systems. Published as `toad-eye` on npm. Provides one-line instrumentation (traces + metrics) and a CLI to scaffold/manage a Docker-based observability stack (OTel Collector, Prometheus, Jaeger, Grafana).

## Monorepo structure

npm workspaces, two packages:

- `packages/instrumentation` — the npm package (`toad-eye`). Core library + CLI (`bin: toad-eye`).
- `demo` — mock LLM service on Hono for local testing/demos.

Infrastructure configs live in `infra/` (docker-compose, OTel Collector, Prometheus, Grafana dashboards).

## Commands

```bash
# Build the library
npm run build --workspace=packages/instrumentation

# Typecheck entire monorepo
npx tsc --noEmit

# Format
npm run format          # fix
npm run format:check    # check only (CI uses this)

# Demo server
npm run demo            # starts with tsx watch
npm run load --workspace=demo  # send test traffic

# Observability stack
npx toad-eye init       # scaffold configs into infra/toad-eye/
npx toad-eye up         # docker compose up -d
npx toad-eye down       # docker compose down
npx toad-eye status     # show running services
```

## Architecture

`packages/instrumentation/src/` modules:

| Module       | Role                                                                    |
| ------------ | ----------------------------------------------------------------------- |
| `types.ts`   | All types, constants (`LLM_METRICS`, `LLM_ATTRS`), provider union       |
| `tracer.ts`  | `initObservability()` / `shutdown()` — sets up OTel SDK, OTLP exporters |
| `metrics.ts` | Creates histograms and counters, records per-call metrics               |
| `spans.ts`   | `traceLLMCall()` — wraps any async LLM call with a traced span          |
| `cli.ts`     | CLI entry point (`init`, `up`, `down`, `status` commands)               |
| `index.ts`   | Public API re-exports                                                   |

Data flow: App → `traceLLMCall()` → OTel SDK → OTLP HTTP → OTel Collector → Prometheus (metrics) + Jaeger (traces) → Grafana.

## Key conventions

- **ESM only** — `"type": "module"` everywhere, use `.js` extensions in imports
- **TypeScript strict mode** — `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`
- Build target: `ES2024`, module: `NodeNext`
- Formatting: Prettier (no config file, defaults). Pre-commit hook via husky + lint-staged
- CI: GitHub Actions — typecheck only (no test runner yet)
- Supported LLM providers: `"anthropic" | "gemini" | "openai"` (type `LLMProvider`)

## Code style notes

- Omit `: void` return types — considered noise
- Use `as const` for constant objects, derive types with `typeof`
- `readonly` on interface properties and config types
- Optional properties use explicit `| undefined` (`exactOptionalPropertyTypes`)
