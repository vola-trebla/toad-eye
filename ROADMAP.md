# toad-eye Roadmap

**Date:** 2026-03-21
**Current version:** 2.4.1
**Open issues:** 12

---

## Current state

v2.4.1 shipped with full OTel GenAI semconv alignment (#128). Core library: auto-instrumentation for 4 SDKs, budget guards, agent tracing, privacy controls, alerting, 8 Grafana dashboards, subpath exports, 252+ tests. No open bugs.

All remaining issues are **feature work**.

---

## Recommended execution order

### Phase 1: Standards alignment — DONE ✅

| #    | Issue                         | Effort | Status                                                                                                                      |
| ---- | ----------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------- |
| #128 | OTel GenAI agent span semconv | M      | **Done** (v2.4.0) — span naming, agent.name/id, tool.type, toad_eye.\* prefix, compat matrix, OTEL_SEMCONV_STABILITY_OPT_IN |
| #38  | Tool Usage Analytics          | S      | Open — per-tool latency, success rate, call chain visualization                                                             |

#128 delivered in 4 PRs (#170-#173). #38 remains as a quick win.

---

### Phase 2: Ecosystem expansion

| #    | Issue                                         | Effort | Why now                                                                                                                                                                                                                                 |
| ---- | --------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #125 | MCP Server Instrumentation Middleware         | M      | MCP adoption is accelerating. A `toadEyeMiddleware()` for MCP servers would be the first observability solution for MCP — strong positioning. The pattern is similar to existing auto-instrumentation, so the architecture is proven.   |
| #39  | Reasoning Trace for Thinking Models           | M      | o3, o4-mini, Claude thinking mode — all emit chain-of-thought tokens that toad-eye currently ignores. Users can't see reasoning cost vs output cost. Increasingly requested as thinking models become default.                          |
| #127 | LangChain.js / LangGraph Auto-instrumentation | L      | Large user base. LangChain has its own tracing (LangSmith), but many teams prefer vendor-neutral OTel. A `instrument: ['langchain']` option would capture a new audience. Nice-to-have priority is correct — it's a large surface area. |

**Why this phase second:** These expand toad-eye's addressable market. MCP is the biggest opportunity window (first-mover). Reasoning traces align with industry direction.

---

### Phase 3: Production hardening (cloud path)

| #    | Issue                                            | Effort | Why now                                                                                                                 |
| ---- | ------------------------------------------------ | ------ | ----------------------------------------------------------------------------------------------------------------------- |
| #126 | Ingestion Backpressure & Flow Control            | M      | Required before cloud mode can handle real traffic. Without backpressure, a traffic spike can OOM the ingestion server. |
| #132 | HTTP Ingestion: rate limiting, graceful shutdown | M      | Same — production-readiness for the server package. Rate limiting, health checks, graceful drain on SIGTERM.            |
| #25  | Epic 9: Cloud-Ready Architecture                 | L      | Umbrella for #126 + #132 + other cloud infra. Only pursue if cloud mode is a business priority.                         |

**Why this phase third:** Cloud mode is a strategic bet. The self-hosted mode already works well. Only invest here when you're ready to offer a hosted product.

---

### Phase 4: Deep analytics

| #    | Issue                                   | Effort | Why now                                                                                                                                                         |
| ---- | --------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #19  | Epic 3: Session & Conversation Tracking | M      | Session tracking basics exist (sessionId, sessionExtractor). Missing: conversation-level aggregation, multi-turn cost/latency rollup, session replay in Jaeger. |
| #36  | Conversation Quality Degradation        | M      | Depends on #19 — needs session tracking to detect quality drops across conversation turns. Valuable for chatbot teams.                                          |
| #20  | Epic 4: Agentic Observability           | S      | Most of this epic is done (agent steps, handoffs, loops, tool metrics, dashboard). Check remaining stories — may be closeable.                                  |
| #123 | OpenInference Compatibility Bridge      | L      | Bidirectional bridge with Arize Phoenix / LangSmith trace format. Large scope, niche audience. Worth doing if users request it.                                 |

**Why this phase later:** These are analytics depth — valuable but not urgent. The basics already work.

---

### Phase 5: Long-term vision

| #   | Issue                                   | Effort | Why now                                                                                                                                   |
| --- | --------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| #24 | Epic 8: FinOps & Cost Optimization      | M      | FinOps attribution is done. Remaining: cost forecasting, anomaly detection, budget recommendations. Nice differentiator but not critical. |
| #51 | Semantic Cache Integration (toad-cache) | L      | Cross-product play. Only if toad-cache exists and has users.                                                                              |
| #54 | Web Dashboard (Grafana replacement)     | XL     | Massive scope. Only if cloud mode takes off and you want to own the UI layer.                                                             |
| #26 | Epic 10: Community & Ecosystem          | -      | Evergreen — docs, examples, integrations, conference talks. Not a sprint item.                                                            |

---

## Effort legend

- **S** — 1-2 days, single PR
- **M** — 3-5 days, 1-3 PRs
- **L** — 1-2 weeks, multiple PRs
- **XL** — month+, major initiative

## Summary

```
Phase 1 (done):     #128 semconv ✅ + #38 tool analytics   → standards + quick win
Phase 2 (next):     #125 MCP + #39 reasoning + #127 LC    → new audiences
Phase 3 (cloud):    #126 + #132 + #25                      → production infra
Phase 4 (depth):    #19 sessions + #36 quality + #123      → analytics depth
Phase 5 (vision):   #24 + #51 + #54 + #26                 → long-term bets
```

**Next up:** #38 (tool analytics, quick win) or #125 (MCP middleware, first-mover opportunity).
