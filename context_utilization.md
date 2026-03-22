# Context Window Utilization Ratio — metric + alert + dashboard

## Origin

Community request from [article #3 comments](https://dev.to/vola-trebla/opentelemetry-just-standardized-llm-tracing-heres-what-it-actually-looks-like-in-code) — @jidong pointed out that in agentic loops, context window usage per turn is more important than total tokens, since the full conversation is re-sent each iteration. We agreed in the comments and committed to tracking this.

## Problem

In ReAct / multi-turn agent loops, `input_tokens` grows with every iteration as the full conversation history is re-sent. Currently toad-eye tracks `gen_ai.usage.input_tokens` per span, but there's no way to:

1. Know how close you are to the model's context limit
2. Alert before you hit truncation or context overflow
3. See utilization trends across turns in a dashboard

A user running Claude with 200k context might not care at turn 3, but at turn 15 they're silently at 85% and one more tool result tips them over.

## Solution

### 1. Add `maxContextTokens` to pricing table

**File:** `packages/instrumentation/src/core/pricing.ts`

Extend `ModelPricing` interface:

```typescript
export interface ModelPricing {
  readonly inputPer1M: number;
  readonly outputPer1M: number;
  readonly maxContextTokens?: number; // NEW
}
```

Add values to `BUILT_IN_PRICING`:

```typescript
"gpt-4o":                     { inputPer1M: 2.5,  outputPer1M: 10,  maxContextTokens: 128_000 },
"gpt-4o-mini":                { inputPer1M: 0.15, outputPer1M: 0.6, maxContextTokens: 128_000 },
"gpt-4.1":                    { inputPer1M: 2,    outputPer1M: 8,   maxContextTokens: 1_047_576 },
"gpt-4.1-mini":               { inputPer1M: 0.4,  outputPer1M: 1.6, maxContextTokens: 1_047_576 },
"gpt-4.1-nano":               { inputPer1M: 0.1,  outputPer1M: 0.4, maxContextTokens: 1_047_576 },
"o3":                         { inputPer1M: 10,   outputPer1M: 40,  maxContextTokens: 200_000 },
"o3-mini":                    { inputPer1M: 1.1,  outputPer1M: 4.4, maxContextTokens: 200_000 },
"o4-mini":                    { inputPer1M: 1.1,  outputPer1M: 4.4, maxContextTokens: 200_000 },
"claude-opus-4-20250514":     { inputPer1M: 15,   outputPer1M: 75,  maxContextTokens: 200_000 },
"claude-sonnet-4-20250514":   { inputPer1M: 3,    outputPer1M: 15,  maxContextTokens: 200_000 },
"claude-haiku-3-5-20241022":  { inputPer1M: 0.8,  outputPer1M: 4,   maxContextTokens: 200_000 },
"gemini-2.5-pro":             { inputPer1M: 1.25, outputPer1M: 10,  maxContextTokens: 1_048_576 },
"gemini-2.5-flash":           { inputPer1M: 0.15, outputPer1M: 0.6, maxContextTokens: 1_048_576 },
"gemini-2.0-flash":           { inputPer1M: 0.1,  outputPer1M: 0.4, maxContextTokens: 1_048_576 },
```

`setCustomPricing()` already allows overrides, so users with fine-tuned models or custom context windows are covered.

### 2. New metric: `gen_ai.toad_eye.context_utilization`

**File:** `packages/instrumentation/src/core/metrics.ts`

```typescript
// Histogram: 0.0 - 1.0 (ratio of input_tokens / maxContextTokens)
gen_ai.toad_eye.context_utilization;
```

Labels: `gen_ai.provider.name`, `gen_ai.request.model`

### 3. Record utilization in both paths

**File:** `packages/instrumentation/src/core/spans.ts` (traceLLMCall path)
**File:** `packages/instrumentation/src/instrumentations/create.ts` (auto-instrument + streaming path)

After token counts are known:

```typescript
import { getModelPricing } from "./pricing.js";

const pricing = getModelPricing(model);
if (pricing?.maxContextTokens && inputTokens > 0) {
  const utilization = inputTokens / pricing.maxContextTokens;
  span.setAttribute("gen_ai.toad_eye.context_utilization", utilization);
  recordContextUtilization(utilization, provider, model);
}
```

### 4. Span attribute for per-trace queries

```
gen_ai.toad_eye.context_utilization = 0.73  (on each span)
```

This allows Jaeger queries like "show me all spans where context utilization > 0.8".

### 5. Grafana dashboard panel

**File:** `packages/instrumentation/templates/grafana/dashboards/cost-breakdown.json` (or new Agent Workflow panel)

PromQL:

```promql
# P95 context utilization by model
histogram_quantile(0.95, sum by (le, gen_ai_request_model) (rate(gen_ai_toad_eye_context_utilization_bucket[5m])))

# Requests approaching context limit (>80%)
sum(rate(gen_ai_toad_eye_context_utilization_bucket{le="1.0"}[5m])) - sum(rate(gen_ai_toad_eye_context_utilization_bucket{le="0.8"}[5m]))
```

### 6. Alert rule example

```yaml
alerts:
  - name: context_window_bloat
    metric: gen_ai.toad_eye.context_utilization
    condition: p95_pct_5m > 80
    channels: [slack]
```

## Files to touch

| File                             | Change                                                                       |
| -------------------------------- | ---------------------------------------------------------------------------- |
| `src/core/pricing.ts`            | Add `maxContextTokens` to interface + built-in table                         |
| `src/core/metrics.ts`            | New histogram `gen_ai.toad_eye.context_utilization`                          |
| `src/core/spans.ts`              | Record utilization in `traceLLMCall`                                         |
| `src/instrumentations/create.ts` | Record utilization in auto-instrument + streaming paths                      |
| `src/types/index.ts`             | Add metric name constant + attribute constant                                |
| `templates/grafana/dashboards/`  | New panel or dashboard                                                       |
| `__tests__/`                     | Unit tests for utilization calculation, edge cases (unknown model, 0 tokens) |

## Edge cases

- Model not in pricing table → skip utilization (no maxContextTokens known)
- `inputTokens = 0` → skip (no data)
- `utilization > 1.0` → possible with some APIs that allow slight overflow — clamp or record as-is for debugging
- Streaming with 0 tokens (GAP-1 pre-fix) → skip

## Tests

- Unit: utilization = input_tokens / maxContextTokens for known model
- Unit: returns undefined for unknown model
- Unit: `setCustomPricing` with custom `maxContextTokens` works
- Unit: streaming path records utilization after stream completes
- Integration: agent loop with 5 turns → utilization grows per span

## Labels

`enhancement`, `metrics`, `community-request`
