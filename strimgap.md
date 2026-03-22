# toad-eye Streaming & Observability — Gap Analysis + Implementation Plan

> Research: "The Unified Frontier of Generative AI Observability" (2026)
> Codebase: toad-eye v2.4.4
> Date: 2026-03-21

---

## TL;DR

Research confirms toad-eye's core architecture (Incremental Accumulation Pattern) is the industry best practice. But there are **7 critical gaps** and **5 improvement opportunities** that would move us from "works" to "production gold standard". Three of the gaps are bugs that silently lose data right now.

---

## Part 1: What We Already Nailed ✅

Before diving into gaps — credit where it's due. These are patterns the research calls "best practice" that we already implement correctly.

### 1.1 Incremental Accumulation Pattern

Research says this is THE architecture for streaming tracing. We have it in `wrapAsyncIterable()`:

- Transparent async generator proxy — consumer gets chunks untouched
- `StreamAccumulator` with only primitives (no raw SDK objects stored)
- `onFirstChunk` → TTFT, `onComplete` → finalize span, `onError` → record failure
- **`finally` block for abandoned streams** — research explicitly calls this "mandatory"

**Verdict:** Exact match with industry best practice.

### 1.2 Provider-Specific Chunk Extractors

Each provider has its own `accumulateChunk()` — this is correct because SSE formats are fundamentally different:

| Provider  | Text source                        | Token source                            | Status |
| --------- | ---------------------------------- | --------------------------------------- | ------ |
| OpenAI    | `choices[0].delta.content`         | `usage` in final chunk                  | ✅     |
| Anthropic | `content_block_delta → delta.text` | `message_start` + `message_delta`       | ✅     |
| Gemini    | `chunk.text()` with try/catch      | `usageMetadata` (overwrites each chunk) | ✅     |

### 1.3 Privacy-First Content Recording

Research calls `recordContent: false` default the "2026 Gold Standard". We ship with this opt-in. Spec agrees.

### 1.4 Budget Guards on Streaming

`checkBefore()` → stream → `recordCost()` on complete, `releaseReservation()` on error. Research describes this exact pattern for preventing runaway agent costs.

### 1.5 Quality Metrics in Streaming Path

`recordResponseEmpty()` and `recordResponseLatencyPerToken()` fire on stream completion. Research calls these "zero-dependency quality proxies" — we have them.

### 1.6 Context Propagation

`context.bind(ctx, wrapAsyncIterable(...))` — binds the OTel trace context to the generator. Research identifies "Context Leak" as the #1 problem in async agent tracing. We handle it.

---

## Part 2: Critical Gaps 🔴

These are issues that silently lose data, break compatibility, or miss industry requirements.

### GAP-1: OpenAI `stream_options` Not Auto-Injected

**Severity: 🔴 CRITICAL — Silent data loss**

**Problem:** OpenAI does NOT send `usage` in streaming chunks by default. You must explicitly set `stream_options: { include_usage: true }` in the request body. Without it, `acc.inputTokens` and `acc.outputTokens` stay at 0 for every streaming request.

Research quote: "developers must explicitly set `stream_options: { include_usage: true }` in the request body" — and calls discarding the final chunk "a common bug in early instrumentation libraries."

**Current code (`openai.ts`):**

```typescript
accumulateChunk: (acc, chunk) => {
  // ...
  if (c?.usage) {
    // <-- this never fires because usage is never sent
    acc.inputTokens = c.usage.prompt_tokens ?? acc.inputTokens;
    acc.outputTokens = c.usage.completion_tokens ?? acc.outputTokens;
  }
};
```

**Impact:** Every OpenAI streaming request reports 0 tokens → 0 cost → budget guards useless for streaming → FinOps dashboards show wrong data.

**Fix:** In `createStreamingHandler`, mutate the request body before calling `original`:

```typescript
// Auto-inject stream_options for OpenAI to get usage in streaming
if (providerName === "openai") {
  const b = body as Record<string, unknown>;
  if (!b.stream_options) {
    b.stream_options = { include_usage: true };
  }
}
```

**Tests needed:**

- Unit: verify body mutation adds `stream_options`
- Unit: verify `accumulateChunk` captures tokens from final chunk
- Integration: real OpenAI streaming → assert inputTokens > 0

---

### GAP-2: Tool Use in Streaming Not Captured

**Severity: 🔴 CRITICAL — Missing feature for agents**

**Problem:** When LLMs do tool calls in streaming mode, the chunks contain tool call data, not text. Current `accumulateChunk` only captures `delta.content` (text). Tool calls are silently dropped.

**OpenAI tool call chunks:**

```json
{
  "choices": [
    {
      "delta": {
        "tool_calls": [
          {
            "index": 0,
            "function": { "name": "search", "arguments": "{\"q\":" }
          }
        ]
      }
    }
  ]
}
```

**Anthropic tool call chunks:**

```json
{
  "type": "content_block_start",
  "content_block": { "type": "tool_use", "id": "call_1", "name": "search" }
}
```

**Impact:** Agent tracing with streaming is incomplete — you see the agent span but not what tools it called or what arguments it passed.

**Fix:** Extend `StreamAccumulator` with tool call tracking:

```typescript
export interface StreamAccumulator {
  completion: string;
  inputTokens: number;
  outputTokens: number;
  toolCalls: Array<{
    name: string;
    arguments: string;
    id?: string;
  }>;
}
```

Update each provider's `accumulateChunk` to extract tool call data.

**Tests needed:**

- Unit per provider: streaming with tool_calls → accumulator captures tool names + args
- Integration: agent with streaming tool use → Jaeger shows tool call attributes on span

---

### GAP-3: Span Events for TTFT Not Emitted

**Severity: 🟡 MEDIUM — Missing spec compliance**

**Problem:** We record TTFT as a histogram metric (`recordTimeToFirstToken`), but we don't emit the `gen_ai.content.first_token` span event that the spec recommends. Metrics give you P95 aggregates; span events give you per-trace debugging.

Research describes three TTFT signals — we have 1 of 3:

| Signal              | Purpose                 | toad-eye                               |
| ------------------- | ----------------------- | -------------------------------------- |
| Histogram metric    | P95/P99 across requests | ✅ `gen_ai.client.time_to_first_token` |
| Span event          | Per-trace timestamp     | ❌ Missing                             |
| Span attribute (ms) | Easy ad-hoc queries     | ❌ Missing                             |

**Fix:** In `onFirstChunk` callback:

```typescript
onFirstChunk: () => {
  const ttft = performance.now() - start;
  recordTimeToFirstToken(ttft, provider, model);

  // NEW: span event for per-trace analysis
  span.addEvent("gen_ai.content.first_token", {
    "gen_ai.response.time_to_first_token_ms": ttft,
  });

  // NEW: span attribute for easy querying
  span.setAttribute("gen_ai.response.time_to_first_token_ms", ttft);
};
```

---

### GAP-4: Anthropic Extended Thinking Not Handled

**Severity: 🟡 MEDIUM — Growing usage, silent data loss**

**Problem:** Anthropic's extended thinking feature sends `thinking` content blocks with `type: "thinking"`. Our `accumulateChunk` only handles `content_block_delta` with text. Thinking tokens are charged but not tracked.

**New chunk types to handle:**

```
thinking               → content_block_start with type "thinking"
thinking_block_delta   → delta with thinking text
```

**Impact:** Token counts will be wrong for extended thinking requests (thinking tokens are billed separately at different rates). Cost calculations will underreport.

**Fix:** In `anthropic.ts` `accumulateChunk`:

```typescript
accumulateChunk: (acc, chunk) => {
  const event = chunk as { type?: string /* ... */ };

  if (event.type === "content_block_delta") {
    if (event.delta?.type === "thinking_delta" && event.delta?.thinking) {
      // Track thinking content separately (don't append to completion)
      acc.thinkingContent = (acc.thinkingContent ?? "") + event.delta.thinking;
    } else if (event.delta?.text) {
      acc.completion += event.delta.text;
    }
  }
  // ... existing token handling
};
```

Extend `StreamAccumulator` with `thinkingContent?: string` and `thinkingTokens?: number`.

---

### GAP-5: Missing Operation Types

**Severity: 🟡 MEDIUM — Spec compliance gap**

**Problem:** The spec defines 7 operation types. We only use `chat` and agent operations.

| Operation          | Spec | toad-eye                                              |
| ------------------ | ---- | ----------------------------------------------------- |
| `chat`             | ✅   | ✅                                                    |
| `invoke_agent`     | ✅   | ✅                                                    |
| `execute_tool`     | ✅   | ✅                                                    |
| `text_completion`  | ✅   | ❌ Not mapped                                         |
| `embeddings`       | ✅   | ❌ OpenAI embeddings exist but operation.name not set |
| `create_agent`     | ✅   | ❌ N/A for now                                        |
| `generate_content` | ✅   | ❌ Gemini uses `chat` instead                         |

**Fix:**

- OpenAI `Embeddings.create` → set `gen_ai.operation.name = "embeddings"`, span name `embeddings {model}`
- Gemini `generateContent` → set `gen_ai.operation.name = "generate_content"`
- Add `text_completion` when completions endpoint detected

---

### GAP-6: Gemini Safety Filter Mid-Stream

**Severity: 🟡 MEDIUM — Edge case data loss**

**Problem:** We have try/catch around `chunk.text()` in Gemini's `accumulateChunk`, which is good. But when a safety filter triggers mid-stream, `usageMetadata` may only reflect input tokens processed before the block. We don't set an error status or record the safety block reason.

**Fix:** Check for blocked content in Gemini accumulator:

```typescript
accumulateChunk: (acc, chunk) => {
  const c = chunk as {
    text?: () => string;
    usageMetadata?: {
      /* ... */
    };
    candidates?: Array<{ finishReason?: string; safetyRatings?: unknown[] }>;
  };

  // Detect safety block
  const finishReason = c?.candidates?.[0]?.finishReason;
  if (finishReason === "SAFETY") {
    acc.finishReason = "safety_block";
  }
  // ... existing logic
};
```

### GAP-7: Guardrail Attributes Don't Follow Emerging Convention

**Severity: 🟢 LOW — Future-proofing**

**Problem:** Research defines a converging pattern for guardrail attributes:

```
gen_ai.guardrail.outcome   → allow | block | redact | mask
gen_ai.guardrail.category  → toxicity | pii_exposure | ...
gen_ai.guardrail.provider  → amazon_bedrock | custom_regex | ...
```

Our shadow guardrails use `gen_ai.toad_eye.guard.*` which is fine for custom namespace, but we should also emit the emerging standard attributes when applicable.

---

## Part 3: Improvement Opportunities 🔵

Not broken, but could be significantly better.

### IMP-1: Attribute-Level Sampling for Content

**What:** Research describes separating trace sampling from content sampling. 100% of traces get token counts, but only 1% get actual prompt/completion text.

**Current:** Binary `recordContent: true/false`.

**Proposed:**

```typescript
initObservability({
  serviceName: "my-app",
  contentSamplingRate: 0.01, // 1% of requests get content recorded
  // recordContent still works as a hard kill switch
});
```

**Why:** Enables debugging without the storage/privacy cost of logging everything. Teams can afford to record some content when it's 1% instead of all-or-nothing.

---

### IMP-2: OTel Collector Redaction Processor Config

**What:** Research describes the Collector as the "final gate" for PII. We do SDK-level redaction, but we don't ship Collector processor configs.

**Proposed:** Add a `collector-processors/` template with pre-built regex transform configs:

```yaml
processors:
  transform/redact_pii:
    trace_statements:
      - context: span
        statements:
          - replace_pattern(attributes["gen_ai.input.messages"], "\\b\\d{3}-\\d{2}-\\d{4}\\b", "<SSN>")
          - replace_pattern(attributes["gen_ai.input.messages"], "\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Z|a-z]{2,}\\b", "<EMAIL>")
```

Ships with `npx toad-eye init`. Defense in depth — SDK catches most PII, Collector catches the rest.

---

### IMP-3: Eval Integration Hooks

**What:** Research describes the "Observability → Evaluation Loop" as the key competitive advantage. Traces feed into eval pipelines, eval scores written back as attributes.

**Proposed:** Add eval callback in config:

```typescript
initObservability({
  serviceName: "my-app",
  onSpanEnd: async (spanData) => {
    // User provides their eval logic
    const score = await myEvalPipeline.score(spanData);
    // Written as attribute for querying
    spanData.setAttribute("gen_ai.evaluation.score", score);
  },
});
```

This is the bridge between toad-eye (observability) and toad-eval (evaluation). Makes the TOAD ecosystem loop real.

---

### IMP-4: Prefill vs Decode Latency Split

**What:** Research says high prefill latency = long prompts, high decode latency = GPU contention. Currently we track total duration and TTFT, but don't split the decode phase.

**Proposed metrics:**

```
gen_ai.toad_eye.latency.prefill_ms   = TTFT (already have this)
gen_ai.toad_eye.latency.decode_ms    = total_duration - TTFT
gen_ai.toad_eye.throughput.tokens_per_second = output_tokens / (decode_ms / 1000)
```

Almost free to add — we already have both timestamps.

---

### IMP-5: Streaming Span Events for Chunk Cadence

**What:** Research describes recording chunk events for debugging generation jitter. Not recommended as default (volume too high), but useful as opt-in.

**Proposed:** A `streamingEvents: 'full'` option that emits span events per chunk:

```typescript
// Only when streamingEvents: 'full' (off by default)
span.addEvent("gen_ai.content.chunk", {
  "gen_ai.chunk.index": chunkIndex,
  "gen_ai.chunk.tokens": chunkTokens,
  timestamp: performance.now(),
});
```

Use case: debugging why one specific request had 12s TTFT. Was it prefill? Was it stalled mid-stream? Chunk events tell you.

---

## Part 4: Implementation Blocks 🛠️

Ordered by impact × effort. Each block is one PR.

### Block 1: OpenAI stream_options injection 🔴

**Priority: P0 — do first**
**Effort: S (small)**
**Files:** `create.ts` (add body mutation before streaming call)
**Tests:** Unit: body mutation, chunk accumulation with usage. Integration: real streaming.
**Impact:** Fixes silent 0-token bug for ALL OpenAI streaming users.

### Block 2: TTFT span event + attribute

**Priority: P0**
**Effort: XS**
**Files:** `create.ts` (modify onFirstChunk callback)
**Tests:** Unit: span has event + attribute after first chunk.
**Impact:** Spec compliance. Enables per-trace TTFT debugging in Jaeger.

### Block 3: Tool call accumulation in streaming

**Priority: P1**
**Effort: M (medium)**
**Files:** `types.ts` (extend StreamAccumulator), `openai.ts`, `anthropic.ts`, `gemini.ts`, `create.ts` (set tool attrs on span end)
**Tests:** Unit per provider: streaming tool calls captured. Integration: agent streaming trace.
**Impact:** Completes agent observability for streaming mode.

### Block 4: Anthropic extended thinking support

**Priority: P1**
**Effort: S**
**Files:** `anthropic.ts` (handle thinking_delta), `types.ts` (extend accumulator)
**Tests:** Unit: thinking chunks accumulated separately, tokens tracked.
**Impact:** Correct cost tracking for Claude thinking mode.

### Block 5: Operation type alignment

**Priority: P1**
**Effort: S**
**Files:** `openai.ts` (embeddings operation name), `gemini.ts` (generate_content operation)
**Tests:** Unit: correct operation names on spans.
**Impact:** Spec compliance. Backends that filter by operation.name will work correctly.

### Block 6: Prefill/decode latency split

**Priority: P2**
**Effort: XS**
**Files:** `create.ts` (calculate decode_ms), `metrics.ts` (new histogram)
**Tests:** Unit: decode_ms = total - TTFT.
**Impact:** New debugging signal, almost free to add.

### Block 7: Gemini safety filter detection

**Priority: P2**
**Effort: S**
**Files:** `gemini.ts` (check finishReason), `create.ts` (set error status on safety block)
**Tests:** Unit: safety-blocked stream sets error status + reason.
**Impact:** Edge case, but prevents silent failures in safety-filtered responses.

### Block 8: Content sampling rate

**Priority: P2**
**Effort: S**
**Files:** `tracer.ts` (config), `spans.ts` (sampling logic in processContent)
**Tests:** Unit: ~1% of calls get content recorded at rate 0.01.
**Impact:** Privacy/cost improvement. Enables partial content recording.

### Block 9: Collector PII redaction templates

**Priority: P3**
**Effort: S**
**Files:** New `templates/collector-processors.yaml`, update `init` CLI command
**Tests:** Manual: run Collector with config, verify PII stripped.
**Impact:** Defense-in-depth for enterprise users.

### Block 10: Eval integration hooks

**Priority: P3**
**Effort: M**
**Files:** `tracer.ts` (config), `create.ts` (call onSpanEnd), new `eval/` module
**Tests:** Unit: callback fires with span data. Integration: eval score appears on span.
**Impact:** Bridges toad-eye → toad-eval. Closes the observability loop.

---

## Part 5: Testing Strategy

Research reinforced what we learned the hard way (article #2): unit tests with mocked SDKs don't catch real issues.

### Per block:

| Block                | Unit tests                   | Integration test                   | Manual smoke            |
| -------------------- | ---------------------------- | ---------------------------------- | ----------------------- |
| 1 (stream_options)   | Body mutation, chunk parsing | Real OpenAI streaming → tokens > 0 | ✅                      |
| 2 (TTFT event)       | Span has event + attr        | —                                  | Jaeger shows event      |
| 3 (Tool calls)       | Per-provider chunk parsing   | Agent with streaming tools         | Jaeger shows tool attrs |
| 4 (Thinking)         | Thinking delta parsed        | Real Claude extended thinking      | ✅                      |
| 5 (Operations)       | Correct operation.name       | —                                  | Phoenix/Jaeger filter   |
| 6 (Prefill/decode)   | Math: decode = total - TTFT  | —                                  | Grafana panel           |
| 7 (Gemini safety)    | Safety block → error status  | —                                  | ✅                      |
| 8 (Content sampling) | Rate ~1% over 1000 calls     | —                                  | —                       |
| 9 (Collector PII)    | —                            | Collector + transform proc         | ✅                      |
| 10 (Eval hooks)      | Callback fires               | —                                  | —                       |

### Integration test infra needed:

A real end-to-end smoke test (what article #2 taught us was missing):

```bash
npx toad-eye up
node test/smoke/streaming-openai.ts    # real API call, streaming
node test/smoke/streaming-anthropic.ts  # real API call, streaming
# Assert: Jaeger has spans with tokens > 0, TTFT event present, tool calls visible
```

This is the "manual testing guide" from article #2, automated.

---

## Part 6: Article Potential 📝

This work generates at least 2 strong Dev.to articles:

**Article #4:** "Your LLM streaming traces are lying to you" — the stream_options bug, tool calls not captured, TTFT not on spans. Practical, code-heavy, relatable.

**Article #5:** "Closing the Observability → Evaluation Loop" — eval integration hooks, trace-to-dataset, scoring on spans. More visionary, positions toad-eye in the ecosystem.

---

## Appendix: Research ↔ toad-eye Alignment Matrix

| Research Recommendation               | toad-eye Status                            | Gap?  |
| ------------------------------------- | ------------------------------------------ | ----- |
| Incremental Accumulation Pattern      | ✅ `wrapAsyncIterable`                     | —     |
| `finally` block for abandoned streams | ✅ Implemented                             | —     |
| TTFT as histogram metric              | ✅ `gen_ai.client.time_to_first_token`     | —     |
| TTFT as span event                    | ❌ Not emitted                             | GAP-3 |
| TTFT as span attribute (ms)           | ❌ Not set                                 | GAP-3 |
| OpenAI `stream_options` for usage     | ❌ Not auto-injected                       | GAP-1 |
| Anthropic typed event handling        | ✅ State machine in accumulateChunk        | —     |
| Gemini safety filter handling         | ⚠️ Partial (try/catch but no error status) | GAP-6 |
| Tool call capture in streaming        | ❌ Text only                               | GAP-2 |
| Extended thinking support             | ❌ Not handled                             | GAP-4 |
| Privacy opt-in for content            | ✅ `recordContent: false`                  | —     |
| Attribute-level content sampling      | ❌ Binary only                             | IMP-1 |
| Collector-side PII redaction          | ❌ SDK-only                                | IMP-2 |
| Cost tracking per request             | ✅ `gen_ai.toad_eye.cost`                  | —     |
| Budget enforcement                    | ✅ Guards with pre-check                   | —     |
| Custom namespace for non-spec attrs   | ✅ `gen_ai.toad_eye.*`                     | —     |
| Guardrail outcome attributes          | ⚠️ Custom format only                      | GAP-7 |
| Eval score on spans                   | ❌ Not implemented                         | IMP-3 |
| Prefill vs decode split               | ❌ Only total + TTFT                       | IMP-4 |
| Agent span hierarchy                  | ✅ Nested via `traceAgentQuery`            | —     |
| Context propagation in async          | ✅ `context.bind()`                        | —     |
| Span events for chunk cadence         | ❌ Not implemented                         | IMP-5 |
| Operation type taxonomy (7 types)     | ⚠️ 3 of 7                                  | GAP-5 |
