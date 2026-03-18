# toad-eye Execution Plan

## How to work

Each story: `feat branch → PR → merge → close issue`

Start Claude with: `claude --model sonnet` (or opus for complex architecture)

Tell it: `story #XX (N.N Title). Create branch feat/N.N-short-name from main.`

---

## Batch 1: Foundation (critical)

| Order | Story                                         | Issue                                                    | Branch                          | Status |
| ----- | --------------------------------------------- | -------------------------------------------------------- | ------------------------------- | ------ |
| 1     | 1.1 Auto-instrumentation for LLM SDKs         | [#27](https://github.com/vola-trebla/toad-eye/issues/27) | `feat/1.1-auto-instrumentation` | done   |
| 2     | 2.1 Pre-built Grafana Dashboard Suite         | [#32](https://github.com/vola-trebla/toad-eye/issues/32) | `feat/2.1-grafana-dashboards`   | done   |
| 3     | 1.2 "2-Minute Test" — frictionless onboarding | [#28](https://github.com/vola-trebla/toad-eye/issues/28) | `feat/1.2-onboarding-flow`      | done   |
| 4     | 5.1 Cost Alerts                               | [#40](https://github.com/vola-trebla/toad-eye/issues/40) | `feat/5.1-cost-alerts`          | —      |
| 5     | 1.3 Rewrite README — Quick Start in 5 lines   | [#29](https://github.com/vola-trebla/toad-eye/issues/29) | `feat/1.3-readme-rewrite`       | —      |

## Batch 2: Launch

| Order | Story                    | Issue                                                    | Branch                     |
| ----- | ------------------------ | -------------------------------------------------------- | -------------------------- |
| 6     | 10.1 Launch Article      | [#55](https://github.com/vola-trebla/toad-eye/issues/55) | `feat/10.1-launch-article` |
| 7     | 10.3 Landing Page        | [#57](https://github.com/vola-trebla/toad-eye/issues/57) | `feat/10.3-landing-page`   |
| 8     | 10.2 Product Hunt Launch | [#56](https://github.com/vola-trebla/toad-eye/issues/56) | `feat/10.2-product-hunt`   |
| 9     | 10.4 Documentation Site  | [#58](https://github.com/vola-trebla/toad-eye/issues/58) | `feat/10.4-docs-site`      |

## Batch 3: Depth

| Order | Story                               | Issue                                                    | Branch                         |
| ----- | ----------------------------------- | -------------------------------------------------------- | ------------------------------ |
| 10    | 1.4 OTel GenAI Semantic Conventions | [#30](https://github.com/vola-trebla/toad-eye/issues/30) | `feat/1.4-otel-semconv`        |
| 11    | 1.5 Privacy & Security Controls     | [#31](https://github.com/vola-trebla/toad-eye/issues/31) | `feat/1.5-privacy-controls`    |
| 12    | 2.2 Cost Attribution Engine         | [#33](https://github.com/vola-trebla/toad-eye/issues/33) | `feat/2.2-cost-attribution`    |
| 13    | 3.1 Session Correlation             | [#35](https://github.com/vola-trebla/toad-eye/issues/35) | `feat/3.1-session-correlation` |
| 14    | 5.2 Latency Anomaly Detection       | [#41](https://github.com/vola-trebla/toad-eye/issues/41) | `feat/5.2-latency-anomalies`   |
| 15    | 5.3 Error Rate Alerts               | [#42](https://github.com/vola-trebla/toad-eye/issues/42) | `feat/5.3-error-alerts`        |

## Batch 4: Ecosystem

| Order | Story                                   | Issue                                                    | Branch                       |
| ----- | --------------------------------------- | -------------------------------------------------------- | ---------------------------- |
| 16    | 7.1 Trace-to-Dataset Export (toad-eval) | [#45](https://github.com/vola-trebla/toad-eye/issues/45) | `feat/7.1-trace-export`      |
| 17    | 7.2 Guardrails Shadow Mode (toad-guard) | [#46](https://github.com/vola-trebla/toad-eye/issues/46) | `feat/7.2-shadow-guardrails` |
| 18    | 7.3 CI Baseline Provider (toad-ci)      | [#47](https://github.com/vola-trebla/toad-eye/issues/47) | `feat/7.3-ci-baselines`      |
| 19    | 7.4 MCP Live Queries (toad-mcp)         | [#48](https://github.com/vola-trebla/toad-eye/issues/48) | `feat/7.4-mcp-queries`       |
| 20    | 4.1 Agent Step Tracking                 | [#37](https://github.com/vola-trebla/toad-eye/issues/37) | `feat/4.1-agent-tracking`    |
| 21    | 6.1 Semantic Drift Monitoring           | [#43](https://github.com/vola-trebla/toad-eye/issues/43) | `feat/6.1-semantic-drift`    |

## Batch 5: Monetization

| Order | Story                            | Issue                                                    | Branch                      |
| ----- | -------------------------------- | -------------------------------------------------------- | --------------------------- |
| 22    | 8.1 FinOps Attribution Dashboard | [#49](https://github.com/vola-trebla/toad-eye/issues/49) | `feat/8.1-finops-dashboard` |
| 23    | 8.2 Budget Guards (Runtime)      | [#50](https://github.com/vola-trebla/toad-eye/issues/50) | `feat/8.2-budget-guards`    |
| 24    | 9.1 HTTP Ingestion Endpoint      | [#52](https://github.com/vola-trebla/toad-eye/issues/52) | `feat/9.1-http-ingestion`   |
| 25    | 9.2 Cloud-mode SDK Configuration | [#53](https://github.com/vola-trebla/toad-eye/issues/53) | `feat/9.2-cloud-mode`       |
| 26    | 9.3 Web Dashboard                | [#54](https://github.com/vola-trebla/toad-eye/issues/54) | `feat/9.3-web-dashboard`    |

## Batch 6: Advanced

| Order | Story                                   | Issue                                                    | Branch                          |
| ----- | --------------------------------------- | -------------------------------------------------------- | ------------------------------- |
| 27    | 2.3 Provider Health Monitoring          | [#34](https://github.com/vola-trebla/toad-eye/issues/34) | `feat/2.3-provider-health`      |
| 28    | 3.2 Conversation Quality Degradation    | [#36](https://github.com/vola-trebla/toad-eye/issues/36) | `feat/3.2-conversation-quality` |
| 29    | 4.2 Tool Usage Analytics                | [#38](https://github.com/vola-trebla/toad-eye/issues/38) | `feat/4.2-tool-analytics`       |
| 30    | 4.3 Reasoning Trace for Thinking Models | [#39](https://github.com/vola-trebla/toad-eye/issues/39) | `feat/4.3-reasoning-trace`      |
| 31    | 6.2 Response Quality Proxy Metrics      | [#44](https://github.com/vola-trebla/toad-eye/issues/44) | `feat/6.2-quality-proxies`      |
| 32    | 8.3 Semantic Cache Integration          | [#51](https://github.com/vola-trebla/toad-eye/issues/51) | `feat/8.3-semantic-cache`       |
