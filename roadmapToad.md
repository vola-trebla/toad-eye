# toad-eye Roadmap 🐸🗺️

> Updated: 2026-03-22 (post-review of v2.5.0)
> Prioritized by: impact × effort, weighted toward stability and correctness over features.

---

## Phase 0: Technical Debt & Critical Fixes (v2.6.0) 🔴

**Timeline:** 1–2 weeks. Ship nothing new until this is done.

### TD-1: Eliminate spans.ts / create.ts Duplication

**Priority:** P0 — every future feature is blocked by this
**Files:** `core/spans.ts`, `instrumentations/create.ts`
**What:** Extract shared orchestration (budget check → call → metrics → context guard → budget reconcile) into a reusable function. Both `traceLLMCall` and `createStreamingHandler` should compose this, not copy it.
**Why:** Currently ~150 lines of identical business logic in two places. Bug fixes require dual changes. Context guard logic already diverged (pre-call guard is dead code in `context/guard.ts`, post-call guard is copy-pasted with slight differences).
**Effort:** M
**Tests:** Verify both paths produce identical metrics/spans for same input.

### TD-2: Wire Up or Remove `checkContextGuard()`

**Priority:** P0 — advertised feature doesn't work
**Files:** `context/guard.ts`, `core/spans.ts`, `instrumentations/create.ts`
**What:** `checkContextGuard()` exists but is never called. Either wire it into the pre-call path (both traceLLMCall and streaming) so `blockAt` actually blocks before execution, or remove it and update docs to clarify that context guard is post-call only.
**Decision needed:** Should `blockAt` prevent the call (save money) or just warn after (simpler)? Current README implies prevention.
**Effort:** S

### TD-3: Pin Docker Image Versions

**Priority:** P0 — reproducibility
**File:** `templates/docker-compose.yml`
**What:** Replace `:latest` with specific versions:

```yaml
otel/opentelemetry-collector-contrib:0.102.0
prom/prometheus:v2.53.0
jaegertracing/all-in-one:1.58
grafana/grafana:11.1.0
```

**Effort:** XS

### TD-4: Add Secret Detection Warning in Alert Config

**Priority:** P1
**Files:** `alerts/index.ts`
**What:** After parsing alert config, scan string values for patterns that look like tokens/passwords (no `${` wrapping, length > 20, entropy check). Emit `console.warn` suggesting env var interpolation.
**Effort:** S

### TD-5: Guard Metrics Against Uninitialized Access

**Priority:** P1
**File:** `core/metrics.ts`
**What:** Either initialize all instruments with no-op stubs (`{ record: () => {} }`) or add `if (!initialized) return` guards to every `record*` function. Currently calling any metric function before `initMetrics()` throws.
**Effort:** XS

### TD-6: Remove Unused `spawn` Import

**Priority:** P2
**File:** `cli.ts`, line 2
**Effort:** XS

### TD-7: Normalize Console Warning Prefixes

**Priority:** P2
**All files with console.warn/log**
**What:** Standardize to `"toad-eye: ..."` for library code, `"[toad-eye alerts] ..."` for alert subsystem, `"[toad-eye drift] ..."` for drift subsystem.
**Effort:** S

---

## Phase 1: Testing & CI Hardening (v2.7.0) 🟡

**Timeline:** 2–3 weeks

### TEST-1: Integration Test with Real OTel Collector

**Priority:** P0
**What:** Docker-based test that starts Collector + Prometheus + Jaeger, runs `initObservability()`, sends traces, verifies they appear in Jaeger API and metrics in Prometheus API.
**Why:** Current tests mock OTel SDK — they don't catch export failures, metric name mismatches, or Collector config issues.
**Effort:** L

### TEST-2: Grafana Dashboard Query Validation

**Priority:** P1
**What:** Script that extracts all PromQL queries from dashboard JSON files and validates they reference metrics that exist in `GEN_AI_METRICS`.
**Why:** Metric renames have broken dashboards twice (v2.3.0, v2.4.0).
**Effort:** S

### TEST-3: CLI E2E Test

**Priority:** P1
**What:** Test `init` → verify files exist → `up` → `status` → `demo` (short run) → `down`. Requires Docker in CI.
**Effort:** M

### TEST-4: Real SDK Patching Tests

**Priority:** P1
**What:** Install actual `openai`, `@anthropic-ai/sdk`, `@google/generative-ai` as devDependencies and verify monkey-patching works against real prototypes (with mocked network).
**Why:** Current auto-instrumentation tests mock the SDK module — they don't catch prototype path changes in SDK updates.
**Effort:** M

### TEST-5: Add ESLint or Biome

**Priority:** P2
**What:** Add a linter to catch unused imports, unreachable code, and enforce consistent patterns. Biome is faster and simpler for a TS-only project.
**Effort:** S

### CI-1: Add `npm audit` Step

**Priority:** P2
**Effort:** XS

### CI-2: Add Dependabot or Renovate

**Priority:** P2
**Effort:** XS

---

## Phase 2: Core Feature Gaps (v2.8.0–v2.9.0) 🟢

**Timeline:** 4–6 weeks

### FEAT-1: Plugin API for Provider Instrumentations

**Priority:** P1
**What:** Public `registerInstrumentation()` API so users can add custom providers without forking. Current `registry.ts` hardcodes three providers.

```typescript
import { registerInstrumentation } from "toad-eye";
import { mistralInstrumentation } from "toad-eye-mistral";
registerInstrumentation(mistralInstrumentation);
```

**Effort:** M

### FEAT-2: Content Sampling Rate

**Priority:** P1 — already designed in `strimgap.md`
**What:** `contentSamplingRate: 0.01` — 1% of requests get prompt/completion recorded, 100% get token counts. Currently binary `recordContent: true/false`.
**Why:** Enables debugging without storing everything. Teams can afford 1% content recording.
**Effort:** S

### FEAT-3: Eval Integration Hooks (`onSpanEnd`)

**Priority:** P1 — biggest strategic gap vs competitors
**What:** `onSpanEnd` callback in config that receives span data, allowing users to pipe to eval frameworks:

```typescript
initObservability({
  onSpanEnd: async (spanData) => {
    const score = await myEval(spanData);
    spanData.setAttribute("gen_ai.evaluation.score", score);
  },
});
```

**Why:** Closes the "observe → evaluate → improve" loop. Bridges toad-eye to toad-eval. This is what Langfuse and Arize do natively.
**Effort:** M

### FEAT-4: Collector PII Redaction Templates

**Priority:** P2 — already designed in `strimgap.md`
**What:** Ship pre-built OTel Collector transform processor configs for PII redaction. Defense-in-depth: SDK catches most, Collector catches the rest.
**Effort:** S

### FEAT-5: Pricing API Key Warning on $0 Cost

**Priority:** P2
**File:** `core/pricing.ts`
**What:** When `calculateCost` returns 0 for a model with tokens > 0, emit a one-time warning: "Unknown model pricing for {model}. Use setCustomPricing() to set rates."
**Effort:** XS

### FEAT-6: Structured Output Validation Metrics

**Priority:** P2
**What:** New metric `gen_ai.toad_eye.response.schema_valid` — records whether LLM output matches expected schema. Useful for JSON mode / tool use validation.
**Effort:** M

### FEAT-7: Retry Detection

**Priority:** P2
**What:** Detect when the same prompt is sent multiple times within a short window. Add span attribute `gen_ai.toad_eye.retry_count` and metric `gen_ai.toad_eye.retries`.
**Effort:** M

---

## Phase 3: Cloud Mode & Scale (v3.0.0) 🔵

**Timeline:** 8–12 weeks

### CLOUD-1: Decide Server Fate

**Priority:** P0 for this phase
**What:** `packages/server` is a prototype with in-memory storage. Either:

- (a) Invest in it: add PostgreSQL/ClickHouse storage, auth, multi-tenancy, deploy pipeline
- (b) Remove it from workspaces and focus on self-hosted
  **Current state:** Not in CI, not tested in CI, not documented. Phantom workspace.
  **Effort:** L (for option a), XS (for option b)

### CLOUD-2: Multi-Tenant Isolation

**Priority:** P1 (if cloud mode proceeds)
**What:** API key → tenant isolation in storage, metrics, and traces. Currently `apiKey` is just a Bearer token with no tenant mapping.
**Effort:** L

### CLOUD-3: Prompt/Response Search

**Priority:** P1
**What:** Jaeger doesn't index span attribute values for full-text search. Either integrate with a search backend (OpenSearch, ClickHouse) or build a lightweight index.
**Effort:** L

### CLOUD-4: Feedback API

**Priority:** P2
**What:** `recordFeedback({ traceId, score, comment })` — correlates user feedback with traces. Enables the full observe → evaluate → improve loop.
**Effort:** M

---

## Phase 4: Ecosystem & Community (Ongoing) 🌱

### ECO-1: Expand Provider Coverage

**Priority:** P2
**What:** Mistral, Cohere, AWS Bedrock, Azure OpenAI. Use plugin API (FEAT-1) — each as separate package.
**Effort:** S per provider

### ECO-2: OpenInference Bridge

**Priority:** P2 — already tracked as issue #123
**What:** Emit OpenInference attributes alongside OTel GenAI so Arize Phoenix users get full UI.
**Effort:** M

### ECO-3: Langfuse SpanProcessor

**Priority:** P3
**What:** Optional SpanProcessor that maps toad-eye attributes to Langfuse format for users who want Langfuse's UI but toad-eye's instrumentation.
**Effort:** M

### ECO-4: LLM Cache Integration

**Priority:** P3
**What:** Span attribute `gen_ai.toad_eye.cache_hit` when response comes from cache (semantic or exact). Metric `gen_ai.toad_eye.cache.hit_rate`. Requires user to call a helper.
**Effort:** S

---

## Deprioritized / Removed

| Item                                | Reason                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------- |
| ~~Streaming span events per chunk~~ | Too high volume for default. Covered by TTFT + decode split already shipped in v2.5.0 |
| ~~Prefill/decode latency split~~    | Already shipped in v2.4.5                                                             |
| ~~OpenAI stream_options injection~~ | Already shipped in v2.4.5                                                             |
| ~~TTFT span event~~                 | Already shipped in v2.4.5                                                             |
| ~~Gemini safety filter detection~~  | Edge case, P3 → move to backlog                                                       |
| ~~OTel semconv alignment~~          | Already shipped in v2.4.0                                                             |

---

## Decision Log

| Date       | Decision                                    | Rationale                                                                   |
| ---------- | ------------------------------------------- | --------------------------------------------------------------------------- |
| 2026-03-22 | Phase 0 (tech debt) before any new features | Code duplication makes every new feature 2x effort. Dead code erodes trust. |
| 2026-03-22 | Integration tests before cloud mode         | Can't build on a foundation we can't verify.                                |
| 2026-03-22 | Plugin API before more providers            | Better to ship 3 solid providers + extensibility than 10 fragile ones.      |
| 2026-03-22 | Eval hooks as P1 feature                    | Biggest strategic gap vs Langfuse/Arize. Differentiates TOAD ecosystem.     |
