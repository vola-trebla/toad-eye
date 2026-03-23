# toad-eye Code Review 🐸🔍

**Reviewer:** Senior AI Fullstack Engineer
**Codebase version:** v2.5.0 (2026-03-22)
**Scope:** Full codebase — `packages/instrumentation/`, `packages/server/`, `demo/`, infra templates, CI, tests

---

## Executive Summary

toad-eye is a well-structured, opinionated LLM observability toolkit that punches above its weight for a solo-developer project. The core architecture (OTel SDK → OTLP → Collector → Prometheus/Jaeger → Grafana) is sound and follows industry patterns. TypeScript strict mode, ESM-only, and clean module boundaries show engineering maturity.

However, behind the polished README lies a codebase with significant **code duplication**, **missing integration tests**, **security gaps in the alert system**, and **architectural coupling** that will block scaling. The cloud-mode server (`packages/server/`) is essentially a prototype with in-memory storage. The mono-repo has a phantom workspace (`packages/server`) that isn't referenced from root scripts.

**Verdict:** Solid for solo/small-team use. Not production-ready for enterprise without addressing the critical and important issues below.

---

## 1. Critical Issues (Fix Immediately) 🔴

### CRIT-1: Massive Code Duplication Between `spans.ts` and `create.ts`

**Files:** `core/spans.ts` (traceLLMCall), `instrumentations/create.ts` (createStreamingHandler)

The streaming handler in `create.ts` duplicates ~80% of `traceLLMCall` logic from `spans.ts`:

- Budget check before call (lines 108–131 in create.ts ≈ lines 165–180 in spans.ts)
- Context utilization calculation + guard (create.ts onComplete callback ≈ spans.ts lines 224–260)
- Quality proxy metrics (empty response, latency per token)
- FinOps attribute resolution
- Error handling + budget release

**Impact:** Any bug fix or feature addition must be applied in **two places**. Context guard logic was already copy-pasted with slight deviations — `create.ts` doesn't call `checkContextGuard()` from `context/guard.ts` (the pre-call guard), only the post-call warning. The pre-call guard in `context/guard.ts` exists but is never called from any code path — it's dead code.

**Fix:** Extract shared orchestration into a common function. The streaming path should call the same budget/context/metrics pipeline as the non-streaming path, just with different input sources (accumulator vs direct output).

### CRIT-2: `context/guard.ts` `checkContextGuard()` Is Dead Code

**File:** `context/guard.ts`

`checkContextGuard()` was designed to be called **before** an LLM call to block requests that would exceed context limits. It throws `ToadContextExceededError`. But:

- `traceLLMCall()` in `spans.ts` never calls it
- `createStreamingHandler()` in `create.ts` never calls it
- It's exported from `context/index.ts` but never imported anywhere in the codebase
- The config has `contextGuard.blockAt` but the only blocking logic is in the post-call path (spans.ts line 236), which is **after** the LLM call already completed — defeating the purpose

**Impact:** Users configure `blockAt` expecting requests to be blocked before execution. Instead, the LLM call runs, costs money, and only a `console.warn` + metric is emitted after the fact.

### CRIT-3: Alert Channels Expose Secrets in Plaintext Config

**File:** `alerts/index.ts` (`startAlertsFromFile`), `alerts/types.ts`

The YAML alert config stores secrets in plaintext:

- Telegram bot tokens
- Slack webhook URLs
- SMTP passwords
- Grafana API keys

While `resolveEnvVars()` supports `${ENV_VAR}` interpolation, the example config (`alerts.example.yml`) shows hardcoded values as the primary pattern:

```yaml
token: "BOT_TOKEN"
chatId: "CHAT_ID"
```

There's no validation that secrets come from env vars, no warning when plaintext secrets are detected, and no `.gitignore` entry for `alerts.yml`.

**Impact:** Users will copy the example, paste real tokens, and commit them.

### CRIT-4: Docker Compose Uses `:latest` Tags for All Images

**File:** `templates/docker-compose.yml`

All four services use `image: xxx:latest`:

```yaml
image: otel/opentelemetry-collector-contrib:latest
image: prom/prometheus:latest
image: jaegertracing/all-in-one:latest
image: grafana/grafana:latest
```

**Impact:** Builds are non-reproducible. A breaking change in any upstream image silently breaks the entire stack. The OTel Collector Contrib image is especially volatile — processor configs change between versions. This has already bitten users (CHANGELOG v2.4.3 mentions "update deprecated exporter aliases").

---

## 2. Important Issues (Fix Soon) 🟡

### IMP-1: No Linter — Only Prettier

**Files:** `package.json`, CI workflow

The project has Prettier for formatting but **no ESLint** or Biome. TypeScript strict mode catches type errors, but not:

- Unused variables/imports (5+ instances found across codebase)
- Unreachable code
- Consistent error handling patterns
- `console.log/warn` usage hygiene (there are 40+ `console.warn` calls with inconsistent formatting)
- Import ordering

**Impact:** Code quality will degrade as contributors increase. The `eslint-disable` comments in `create.ts` suggest ESLint was once used but removed.

### IMP-2: Metrics Module Has Uninitialized Variable Risk

**File:** `core/metrics.ts`

All metric instruments are declared as `let` without initialization:

```typescript
let requestDuration: Histogram;
let requestCost: Histogram;
// ... 18 more
```

If any `record*` function is called before `initMetrics()`, it will throw a runtime error (calling `.record()` on `undefined`). While `initObservability` → `initMetrics` is the intended flow, the functions are exported individually and could be called directly.

**Fix:** Either initialize with no-op stubs, or add a guard check in each function. The current pattern relies on correct call ordering — fragile.

### IMP-3: Budget Tracker Is Not Thread-Safe for Serverless

**File:** `budget/tracker.ts`

`BudgetTracker` stores state in a class instance with `Map<string, number>`. In serverless environments (Vercel, Lambda), each cold start creates a new tracker — budget state is lost. The `restoreState()` method exists but requires the user to manually persist/restore, which is documented nowhere.

For Node.js long-running servers: concurrent requests share the same `BudgetTracker` instance, but the `reservedCost` pattern has a race window — `checkBefore` and `recordCost` are not atomic. The comment "reduces race window" acknowledges this.

**Fix:** Document the serverless limitation prominently. Consider a Redis/KV adapter interface for distributed budget tracking.

### IMP-4: Streaming Handler Creates Span Outside `startActiveSpan`

**File:** `instrumentations/create.ts`, line 120

```typescript
const span: Span = tracer.startSpan(`chat ${effectiveModel}`);
const ctx = trace.setSpan(context.active(), span);
```

This creates a span and manually manages context, while `traceLLMCall` in `spans.ts` uses `tracer.startActiveSpan()`. The difference: `startActiveSpan` automatically makes the span active for child operations. The manual approach in the streaming handler means any child spans created during stream consumption won't automatically parent to this span unless the consumer explicitly uses the bound context.

**Impact:** Agent steps traced during streaming consumption may not connect to the LLM call span in Jaeger.

### IMP-5: `packages/server` Is a Phantom Workspace

**File:** Root `package.json`

```json
"workspaces": ["packages/instrumentation", "packages/server", "demo"]
```

`packages/server` is listed as a workspace but:

- No `build` or `test` script in root references it
- CI doesn't build or test it
- It has `"private": true` and version `0.1.0`
- It uses `hono-rate-limiter` which isn't in the lockfile check
- In-memory storage (`storage/memory.ts`) — not production-ready

**Impact:** Dead code that inflates `npm ci` time and creates false confidence. Either develop it or remove it from workspaces.

### IMP-6: Pricing Table Requires Manual Updates

**File:** `core/pricing.ts`

15 models are hardcoded. When a provider updates pricing (which happens monthly), users get wrong cost data until toad-eye publishes a new version. There's no warning when a model is not found in the pricing table — `calculateCost` silently returns 0.

**Fix:** At minimum, `console.warn` when returning 0 for a model with token usage > 0. Ideally, fetch pricing from a remote source with local cache fallback.

### IMP-7: No E2E / Integration Tests

**Files:** `__tests__/*.test.ts`

All 17 test files are unit tests with mocked OTel SDK. The project's own `strimgap.md` document acknowledges this: "unit tests with mocked SDKs don't catch real issues." There is:

- No test that starts the OTel Collector and verifies traces arrive in Jaeger
- No test that verifies Grafana dashboard queries return data
- No test that verifies the CLI `init` → `up` → `demo` → `down` flow
- No test that patches a real OpenAI/Anthropic SDK instance

The `demo/src/test-auto-instrument.ts` exists but isn't in CI.

### IMP-8: Grafana Dashboards Have No Automated Validation

**Files:** `templates/grafana/dashboards/*.json`

8 dashboard JSON files (74KB total) are hand-maintained. When metric names change (they've changed twice — from `llm.*` to `gen_ai.*`), dashboards must be manually updated. There's no test that PromQL queries reference metrics that actually exist.

---

## 3. Minor Issues (Fix When Convenient) 🟢

### MIN-1: Inconsistent `console.warn` Prefix Format

Mixed patterns across the codebase:

- `"toad-eye: ..."` (tracer.ts, spans.ts)
- `"[toad-eye] ..."` (drift/monitor.ts)
- `"[toad-eye alerts] ..."` (alerts/manager.ts)
- `"⚠️  OTel Collector not reachable..."` (cli.ts — no prefix)

### MIN-2: `yaml` Dependency Used Only in Alerts + CLI

**File:** `package.json` — `yaml` is a runtime dependency (2.7.0). It's only used in `alerts/index.ts` (startAlertsFromFile) and `export.ts` (traceToEvalYaml). For users who don't use alerts or export, it's dead weight.

**Fix:** Move to a subpath export or lazy import.

### MIN-3: SMTP Transporter Cache Leaks in Long-Running Processes

**File:** `alerts/channels.ts`

```typescript
const smtpTransporterCache = new Map<string, any>();
```

Transporters are cached forever. If SMTP credentials rotate, stale connections persist. No TTL, no cleanup on `AlertManager.stop()`.

### MIN-4: `spawn` Import Unused in CLI

**File:** `cli.ts`, line 2

```typescript
import { execFileSync, spawn } from "node:child_process";
```

`spawn` is imported but never used.

### MIN-5: `CLAUDE.md` Lists "5 dashboards" but README Says "8 dashboards"

**File:** `CLAUDE.md` line 34 vs `README.md` feature table

```
CLAUDE.md: "Grafana: http://localhost:3100 (admin/admin) — 5 dashboards"
README.md: "8 Grafana dashboards"
```

The actual count in templates is 8 JSON files. `CLAUDE.md` is stale.

### MIN-6: `LLMProvider` Type Widened to `string & {}` But Not Validated

**File:** `types/providers.ts`

```typescript
export type LLMProvider = "anthropic" | "gemini" | "openai" | (string & {});
```

This allows any string, which is useful for custom providers, but there's no runtime validation. A typo like `"opanai"` silently creates a new provider category in metrics, splitting dashboards.

### MIN-7: Cosine Similarity Doesn't Validate Vector Length Match

**File:** `drift/cosine.ts`

```typescript
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  // No check that a.length === b.length
  for (let i = 0; i < a.length; i++) { ... }
```

If vectors have different lengths, the function silently computes a partial result.

---

## 4. Architecture Recommendations 🏗️

### ARCH-1: Extract Shared Orchestration Layer

The core tracing logic (budget check → LLM call → record metrics → context guard → budget reconcile) is duplicated between `traceLLMCall` and `createStreamingHandler`. Extract a `TracingOrchestrator` that both consume:

```
traceLLMCall()  ─┐
                 ├─→ Orchestrator { budget, context, metrics, span }
createStream()  ─┘
```

### ARCH-2: Plugin Architecture for Provider Instrumentations

Currently, adding a new provider (e.g., Mistral, Cohere) requires modifying `registry.ts` and creating a new file. A plugin API would allow:

```typescript
import { registerInstrumentation } from "toad-eye";
registerInstrumentation(mistralInstrumentation);
```

### ARCH-3: Decouple CLI from Library Core

`cli.ts` imports `initObservability`, `traceLLMCall`, `shutdown`, and `calculateCost` from `index.ts`. The demo command creates a full OTel SDK instance. This means the CLI binary pulls in the entire OTel dependency tree even for `toad-eye init` which just copies files.

**Fix:** Lazy-import library functions only in the `demo` command path.

### ARCH-4: Event-Based Alert Engine

The current alerting polls Prometheus on an interval. For production use, consider a push model where metrics thresholds trigger alerts via OTel Collector's `routing` processor, removing the Prometheus dependency for alerting.

---

## 5. Missing Features for Production LLM Observability 📋

| Feature                          | Status                                               | Priority          |
| -------------------------------- | ---------------------------------------------------- | ----------------- |
| **Multi-tenant isolation**       | Missing — single-tenant only                         | P1 for cloud mode |
| **Prompt/response search**       | Missing — Jaeger doesn't index content               | P1                |
| **A/B test tracking**            | Missing — no experiment ID support                   | P2                |
| **Token usage forecasting**      | Missing — only historical reporting                  | P2                |
| **Retry detection**              | Missing — retries create separate traces             | P2                |
| **Rate limit tracking**          | Partial — errors recorded but no 429-specific metric | P2                |
| **Structured output validation** | Missing — no schema validation metrics               | P2                |
| **Feedback loop**                | Missing — no user feedback → trace correlation       | P2                |
| **Cost anomaly detection**       | Partial — threshold alerts but no ML-based anomaly   | P3                |
| **Compliance audit log**         | Missing — no immutable audit trail                   | P3                |

---

## 6. Competitor Comparison 🥊

### toad-eye vs OpenLLMetry

| Dimension               | toad-eye                                              | OpenLLMetry                              |
| ----------------------- | ----------------------------------------------------- | ---------------------------------------- |
| **Setup DX**            | ✅ Ahead — 3 commands, Docker Compose included        | Requires manual OTel setup               |
| **Provider coverage**   | 3 + Vercel AI SDK                                     | 10+ (including Bedrock, Cohere, Mistral) |
| **Streaming support**   | ✅ Ahead — full accumulator pattern, TTFT, tool calls | Basic                                    |
| **Agent tracing**       | ✅ Ahead — ReAct, handoffs, loop detection            | Limited                                  |
| **Dashboards**          | ✅ Ahead — 8 pre-built Grafana dashboards             | None shipped                             |
| **Budget guards**       | ✅ Unique feature                                     | Not available                            |
| **Semantic drift**      | ✅ Unique feature                                     | Not available                            |
| **Community**           | Small (solo dev)                                      | Larger (Traceloop-backed)                |
| **Backend flexibility** | Any OTel backend                                      | Any OTel backend                         |

### toad-eye vs Langfuse

| Dimension             | toad-eye                       | Langfuse                                 |
| --------------------- | ------------------------------ | ---------------------------------------- |
| **Architecture**      | OTel-native, self-hosted infra | Custom protocol, hosted SaaS + self-host |
| **Setup**             | ✅ Simpler for OTel users      | Simpler for non-OTel users               |
| **Prompt management** | ❌ Missing                     | ✅ Built-in prompt versioning            |
| **Eval integration**  | Partial (trace export)         | ✅ Built-in eval framework               |
| **Search/explore**    | ❌ Basic (Jaeger)              | ✅ Rich UI with filters                  |
| **User feedback**     | ❌ Missing                     | ✅ Score/feedback API                    |
| **Pricing**           | Free (self-hosted)             | Free tier + paid                         |
| **Vendor lock-in**    | None (OTel standard)           | Moderate (custom SDK)                    |

### toad-eye vs Helicone

| Dimension              | toad-eye                | Helicone              |
| ---------------------- | ----------------------- | --------------------- |
| **Integration method** | SDK instrumentation     | Proxy (URL swap)      |
| **Latency overhead**   | ~0ms (async export)     | +50-200ms (proxy hop) |
| **Cost tracking**      | ✅ Comparable           | ✅ Comparable         |
| **Caching**            | ❌ Missing              | ✅ Built-in LLM cache |
| **Rate limiting**      | ❌ Missing              | ✅ Built-in           |
| **Self-hosted**        | ✅ Yes                  | Partial               |
| **Custom models**      | ✅ `setCustomPricing()` | Limited               |

### Summary

toad-eye's competitive advantages are: zero-overhead OTel-native instrumentation, budget guards, agent tracing, streaming TTFT, and batteries-included Docker stack. Its weaknesses are: limited provider coverage, no prompt management, no built-in search UI, and a missing evaluation loop. The biggest strategic gap is the lack of a **feedback/eval integration** — competitors are building the "observe → evaluate → improve" loop while toad-eye stops at "observe."

---

## 7. Dependency Audit 📦

| Dependency                                               | Version           | Risk      | Notes                                                         |
| -------------------------------------------------------- | ----------------- | --------- | ------------------------------------------------------------- |
| `@opentelemetry/*`                                       | ^0.213.0 / ^2.6.0 | ⚠️ Medium | OTel JS SDK is pre-1.0 for some packages. Pin minor versions. |
| `yaml`                                                   | ^2.7.0            | ✅ Low    | Stable, but only needed for alerts/export                     |
| `nodemailer`                                             | peer, optional    | ⚠️ Medium | Used only for email alerts. Large dep tree.                   |
| `openai` / `@anthropic-ai/sdk` / `@google/generative-ai` | peer, optional    | ✅ Low    | Correct as peer deps                                          |
| `vitest`                                                 | ^4.1.0            | ✅ Low    | Dev only                                                      |
| `tsx`                                                    | ^4.21.0           | ✅ Low    | Dev only                                                      |
| `husky`                                                  | ^9.1.7            | ✅ Low    | Dev only                                                      |

**Missing:** No `npm audit` step in CI. No Dependabot/Renovate config.

---

## 8. Test Coverage Analysis 🧪

| Module              | Test File                           | Lines | Coverage Quality                                               |
| ------------------- | ----------------------------------- | ----- | -------------------------------------------------------------- |
| `core/spans.ts`     | `spans.test.ts`                     | 508   | ✅ Good — covers PII, hashing, cost, budget, context           |
| `core/tracer.ts`    | `tracer.test.ts`                    | 213   | ⚠️ Mocked SDK — doesn't test real OTel export                  |
| `budget/tracker.ts` | `budget.test.ts`                    | 269   | ✅ Good — covers daily reset, concurrent reservations          |
| `alerts/`           | `alert-manager.test.ts`             | 336   | ⚠️ Mocked fetch — doesn't test real Prometheus queries         |
| `agent.ts`          | `agent.test.ts`                     | 428   | ✅ Good — covers ReAct, handoffs, loop detection               |
| `instrumentations/` | `auto-instrumentation.test.ts`      | 259   | ❌ Poor — tests mocked SDK, not real patching                  |
| `instrumentations/` | `streaming.test.ts`                 | 305   | ⚠️ Tests accumulator logic in isolation, not wrapAsyncIterable |
| `drift/`            | `monitor.test.ts`, `cosine.test.ts` | 197   | ✅ Decent                                                      |
| `export.ts`         | `export.test.ts`                    | 263   | ✅ Good                                                        |
| `cli.ts`            | `cli.test.ts`                       | 49    | ❌ Poor — only tests findContainerByService helper             |
| `vercel.ts`         | `vercel.test.ts`                    | 172   | ⚠️ Tests processor logic with mock spans                       |
| `context/`          | —                                   | 0     | ❌ No tests (dead code anyway)                                 |

**Total:** 3,561 test lines for ~4,500 source lines (0.79 ratio). Good volume but critically lacking in integration tests.

---

_Review completed 2026-03-22. Focus resources on CRIT-1 (duplication) and CRIT-2 (dead code) first — they compound every other issue._
