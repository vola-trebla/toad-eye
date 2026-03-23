# Article #5 — Draft Context

**Target:** dev.to
**Topic:** Your agent is re-sending 80% of your budget every loop and you can't see it
**Status:** Ready to write — context utilization shipped

---

## Hook

"Your ReAct agent runs 15 turns. By turn 10, input_tokens is 150K — you're re-sending the entire conversation history every iteration. That's 80% of your spend on context, not generation. And until now, no observability tool showed you this."

---

## Why this will be viral

This is about money. Every team running agents in production has this problem but can't see it. The article gives them a metric they didn't know they needed.

## Origin

Comment from @jidong on article #3: context window usage per turn matters more than total tokens in agent loops. We built `context_utilization` metric (#188) and context guard (#190) in response.

---

## Story arc

1. **The hidden cost of agent loops** — in ReAct pattern, every turn re-sends the full conversation. Turn 1: 1K input tokens. Turn 5: 15K. Turn 15: 150K. Most of your bill is context re-sends, not new generation.

2. **Why you can't see it today** — existing tools show total tokens per request. But they don't show:
   - What % of context window is used per turn
   - How fast it's growing
   - When you'll hit the limit
   - That 80% of your input tokens are the SAME conversation sent again

3. **Our solution — context_utilization ratio:**

   ```
   utilization = input_tokens / max_context_tokens
   ```

   - Turn 1: 0.01 (1%)
   - Turn 5: 0.12 (12%)
   - Turn 10: 0.45 (45%)
   - Turn 15: 0.85 (85%) — danger zone

4. **Context guard — warn before it's too late:**

   ```typescript
   contextGuard: { warnAt: 0.8, blockAt: 0.95 }
   ```

   Console warns at 80%. At 95% — metric recorded, span event fired.

5. **Built-in model limits:**
   - GPT-4o: 128K
   - Claude: 200K
   - Gemini: 1M
   - All in the pricing table with `maxContextTokens`

6. **What to do about it:**
   - Monitor the metric in Grafana
   - Set up context guard alerts
   - Implement context compression (summarize old turns)
   - Consider sliding window over full history

---

## Grafana dashboard PromQL examples

```promql
# P95 context utilization by model
histogram_quantile(0.95, sum by (le, gen_ai_request_model) (
  rate(gen_ai_toad_eye_context_utilization_bucket[5m])
))

# Requests above 80% utilization
sum(rate(gen_ai_toad_eye_context_utilization_bucket{le="1.0"}[5m]))
- sum(rate(gen_ai_toad_eye_context_utilization_bucket{le="0.8"}[5m]))
```

---

## Code for screenshots

- Context utilization metric: PR #189
- Context guard: PR #192
- maxContextTokens in pricing: same PR #189

---

## Tone

- Money-focused: "this is where your budget goes"
- Concrete numbers: show actual token growth per turn
- Actionable: here's the metric, here's the alert, here's the fix
- Link to jidong's comment as origin

---

## Cross-references

- Article #3 comment from @jidong (origin)
- context_utilization.md (research)
- context_step_size.md (guard research)
- PRs #189, #192
