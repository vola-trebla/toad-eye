---
title: Your LLM streaming traces are lying to you
published: false
tags: ai, opentelemetry, typescript, observability
cover_image: [YOUR_COVER_IMAGE_URL]
series: toad-eye
---

Your traces say the streaming call used 0 tokens and cost $0. Your agent made 3 tool calls but the trace shows none. Latency reads 2.5 seconds — but you have no idea if that was 200ms thinking and 2.3s generating, or 2s stuck in prefill and 500ms actually writing.

Every LLM SDK returns `stream: true` differently. Most observability tools treat streaming as an afterthought. The result: your traces are confidently wrong.

We shipped streaming support in toad-eye v2.2. It passed 252 tests. Then we ran it against real providers and discovered it reported 0 tokens for every single streaming call. This article is about the 5 ways streaming traces lie — and the fixes we shipped across 5 PRs to make them stop.

---

## Lie #1: "0 tokens used, $0 cost"

This one is silent and expensive.

OpenAI does not send usage data in streaming chunks by default. Every chunk arrives with `choices[0].delta.content` — the text — but no `usage` field. The token counts simply aren't there unless you ask for them.

You have to explicitly inject this into the request body:

```typescript
{
  model: "gpt-4o",
  messages: [...],
  stream: true,
  stream_options: { include_usage: true }  // without this: 0 tokens forever
}
```

With this flag, OpenAI sends one final chunk with an empty `choices` array and a populated `usage` object. Without it, your accumulator dutifully records `inputTokens: 0`, `outputTokens: 0`, and your cost dashboards show $0 while your bill grows.

The fix in toad-eye: we auto-inject `stream_options` before the call reaches the SDK. Users don't need to know about it.

![Screenshot: stream_options injection diff](YOUR_STREAM_OPTIONS_SCREENSHOT_URL)
_PR #179: one mutation that turns invisible streaming costs into real numbers._

Here's the fun part: our budget guards use token counts to enforce spend limits. With 0 tokens, every streaming call looked "free" — so budget guards never triggered. The feature designed to prevent the exact problem from [article #1](https://dev.to/vola-trebla/my-ai-bot-burned-through-my-api-budget-overnight-so-i-built-an-open-source-tool-to-make-sure-it-2372) was quietly disabled for all streaming traffic.

## Lie #2: "No tool calls happened"

When an LLM calls a tool during streaming, the chunks don't arrive as a neat JSON object. They arrive in pieces:

```json
// Chunk 1
{ "choices": [{ "delta": { "tool_calls": [{ "index": 0, "function": { "name": "search" } }] } }] }

// Chunk 2
{ "choices": [{ "delta": { "tool_calls": [{ "index": 0, "function": { "arguments": "{\"q\":" } }] } }] }

// Chunk 3
{ "choices": [{ "delta": { "tool_calls": [{ "index": 0, "function": { "arguments": " \"weather\"}" } }] } }] }
```

The function name comes in one chunk. The arguments arrive character by character across dozens of chunks. If your accumulator only captures `delta.content` (text), tool calls are invisible.

Anthropic does it differently — tool use arrives as a `content_block_start` with `type: "tool_use"`, then `input_json_delta` events build the arguments incrementally. Same problem, different wire format.

Our `StreamAccumulator` now tracks tool calls alongside text:

```typescript
export interface StreamAccumulator {
  completion: string;
  inputTokens: number;
  outputTokens: number;
  toolCalls: Array<{
    // NEW
    name: string;
    arguments: string;
    id?: string;
  }>;
}
```

![Screenshot: tool calls accumulator diff](YOUR_TOOL_CALLS_SCREENSHOT_URL)
_PR #180: tool calls captured across all three providers._

For agent observability, this matters a lot. Without tool call data on streaming spans, your Jaeger trace shows the agent "thought" but not what it did. The most useful part of the trace was missing.

## Lie #3: "Latency = 2.5s"

A single duration number for a streaming call is almost meaningless. Two calls can both take 2.5 seconds with completely different stories:

- **Call A:** 200ms to first token, 2.3s generating 500 tokens. Model responded fast, lots of output.
- **Call B:** 2.4s to first token, 100ms generating 20 tokens. Model was stuck in prefill — probably a huge prompt.

The diagnosis is opposite. Call A is healthy. Call B has a context size problem. Same "latency."

The OTel spec recommends three TTFT signals. We now emit all three:

```typescript
// In onFirstChunk callback:
const ttft = performance.now() - start;

// 1. Histogram metric (P95/P99 across requests)
recordTimeToFirstToken(ttft, provider, model);

// 2. Span event (per-trace debugging in Jaeger)
span.addEvent("gen_ai.content.first_token", {
  "gen_ai.response.time_to_first_token_ms": ttft,
});

// 3. Span attribute (easy ad-hoc queries)
span.setAttribute("gen_ai.response.time_to_first_token_ms", ttft);

// Plus: decode latency = total - TTFT
// gen_ai.toad_eye.latency.decode_ms
// gen_ai.toad_eye.throughput.tokens_per_second
```

Now when a call is slow, the first question is: prefill or decode? The answer changes everything about what you fix.

## Lie #4: "No thinking happened"

Anthropic's extended thinking feature sends `thinking` content blocks — the model's reasoning before it responds. These arrive as `thinking_delta` chunks, separate from the regular `content_block_delta` text chunks.

Most tracers don't handle them. The thinking tokens disappear. But they cost money — billed at a different rate — and they represent real compute time that shows up in your latency but not in your traces.

```typescript
// Anthropic chunk types during extended thinking:
{ "type": "content_block_start", "content_block": { "type": "thinking" } }
{ "type": "content_block_delta", "delta": { "type": "thinking_delta", "thinking": "Let me analyze..." } }
// ...many thinking chunks...
{ "type": "content_block_start", "content_block": { "type": "text" } }
{ "type": "content_block_delta", "delta": { "type": "text_delta", "text": "Here's my answer:" } }
```

Our accumulator now tracks thinking separately:

```typescript
if (event.delta?.type === "thinking_delta") {
  acc.thinkingContent += event.delta.thinking;
  // tracked separately — not appended to completion
}
```

This means you can see in your trace: "the model spent 3 seconds thinking, generated 2,000 thinking tokens, then responded in 500ms with 200 output tokens." Without this, the 3 seconds of thinking looks like slow latency and the thinking tokens are unaccounted cost.

## Lie #5: "The call succeeded"

User opens your AI chat. Streaming starts. After 3 seconds and 150 tokens, user closes the tab. Browser kills the connection. Your server's async iterator throws or the `for await` loop ends early.

What does your trace say? If the span is only finalized in `onComplete`, and `onComplete` only fires when the stream is fully exhausted — the span is either missing entirely or stuck open forever.

Our fix: a `finally` block that fires regardless:

```typescript
async function* wrapAsyncIterable<T>(
  stream,
  accumulate,
  onFirstChunk,
  onComplete,
  onError,
) {
  let completed = false;
  let errored = false;
  try {
    for await (const chunk of stream) {
      // accumulate...
      yield chunk;
    }
    completed = true;
    onComplete(acc);
  } catch (err) {
    errored = true;
    onError(err);
    throw err;
  } finally {
    // Consumer broke out early — still record partial data
    if (!completed && !errored) {
      onComplete(acc); // records whatever we accumulated so far
    }
  }
}
```

The `finally` block records partial data: tokens consumed so far, text generated so far, duration up to the point of abandonment. The span closes with real data instead of silence. You billed for those 150 tokens — your trace should show them.

---

## The provider chaos table

Building all of this required handling three completely different SSE implementations. Here's the reality:

|               | Text                  | Tokens                                                    | Tool calls                                                 | Thinking         | Gotchas                                           |
| ------------- | --------------------- | --------------------------------------------------------- | ---------------------------------------------------------- | ---------------- | ------------------------------------------------- |
| **OpenAI**    | `delta.content`       | Final chunk only, opt-in via `stream_options`             | `delta.tool_calls[]` with index                            | N/A              | Empty `choices` on final chunk — don't discard it |
| **Anthropic** | `content_block_delta` | Split: `message_start` (input) + `message_delta` (output) | `content_block_start` type `tool_use` + `input_json_delta` | `thinking_delta` | Requires state machine for event types            |
| **Gemini**    | `chunk.text()`        | `usageMetadata` overwrites each chunk                     | `functionCall` in parts                                    | N/A              | `text()` throws on safety-blocked content         |

Three providers. Three formats. One `StreamAccumulator` interface. Each provider gets its own `accumulateChunk()` extractor that normalizes everything into the same shape.

## What your streaming traces should show

After these fixes, here's what each streaming span contains:

```
gen_ai.operation.name          = "chat"
gen_ai.provider.name           = "openai"
gen_ai.request.model           = "gpt-4o"
gen_ai.usage.input_tokens      = 1,847          ← was 0
gen_ai.usage.output_tokens     = 423            ← was 0
gen_ai.toad_eye.cost           = 0.00886        ← was $0
gen_ai.toad_eye.tool.calls     = 2              ← was invisible
gen_ai.response.time_to_first_token_ms = 340    ← was mixed into total
gen_ai.toad_eye.latency.decode_ms      = 1,960  ← didn't exist
gen_ai.toad_eye.context_utilization    = 0.014   ← didn't exist

Span event: gen_ai.content.first_token at +340ms
```

Every number was either wrong or missing before. Now it's real.

## Quick checklist

If you're tracing LLM streaming — in toad-eye or your own code — check these:

- Are you injecting `stream_options: { include_usage: true }` for OpenAI?
- Does your accumulator capture tool call chunks, not just text?
- Do you split TTFT from total duration?
- Do you handle Anthropic `thinking_delta` if using extended thinking?
- Does your span close correctly when the stream is abandoned?
- Is your `finally` block recording partial data?

If any answer is "no" or "I'm not sure" — your streaming traces are lying to you.

---

**Previous articles:**

- [#1: My AI bot burned through my API budget overnight](https://dev.to/vola-trebla/my-ai-bot-burned-through-my-api-budget-overnight-so-i-built-an-open-source-tool-to-make-sure-it-2372)
- [#2: I audited my tool, fixed 44 bugs — and it still didn't work](https://dev.to/vola-trebla/i-audited-my-tool-fixed-44-bugs-and-it-still-didnt-work-4omk)
- [#3: OpenTelemetry just standardized LLM tracing](https://dev.to/vola-trebla/opentelemetry-just-standardized-llm-tracing-heres-what-it-actually-looks-like-in-code)

**toad-eye** — open-source LLM observability, OTel-native: [GitHub](https://github.com/vola-trebla/toad-eye) · [npm](https://www.npmjs.com/package/toad-eye)

🐸👁️
