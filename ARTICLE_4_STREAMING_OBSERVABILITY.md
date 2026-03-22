# Article #4 — Draft Context

**Target:** dev.to
**Topic:** The hidden complexity of tracing LLM streaming responses
**Status:** Research in progress

мысли
Статья #4: "Your LLM streaming traces are lying to you" — баги в трейсинге
Статья #5 (НОВАЯ): "Your agent is re-sending 80% of your budget every loop and you can't see it" — context window bloat, multi-provider cost drift, per-turn visibility. Конкретная боль из комментов, мы показываем: вот как input_tokens растёт per span в ReAct лупе, вот context_utilization_ratio метрика, вот unified cost tracking через три провайдера. jidong'овская боль, наше решение.
Статья #6: "From traces to evals" — стратегическая, замыкает цикл
Пятая статья будет самой виральной из трёх — потому что она про деньги. "Your agent eats 80% of budget on context re-sends" это заголовок на который кликнет каждый кто гоняет агентов в проде.
Плюс мы можем прям в комменте jidong'у сказать "great point, we're writing a deep dive on this" — и когда статья выйдет, кинуть ему ссылку. Бесплатный первый читатель который точно зашарит.

---

## Origin

Published article #3 about OTel GenAI semconv. Got a comment asking how we handle span attributes for streaming — "that's where I've seen the most inconsistency across implementations since you don't have a clean start and end token count until the stream closes."

Realized this is a real pain point nobody writes about. Everyone uses `stream: true` for UX, but observability tooling largely ignores the complexity.

---

## What we already have

- `wrapAsyncIterable()` — accumulates chunks, sets attributes on stream close
- TTFT metric (Time To First Token) — separate from total duration
- Provider-specific `accumulateChunk()` — OpenAI delta, Anthropic events, Gemini text()
- Abandoned stream handling via `finally` block
- Budget/privacy/quality metrics applied to streaming path (fixed in audit)

## What's missing (to research)

- Inter-chunk latency / generation speed over time
- Token streaming rate (tokens/sec during generation)
- Partial content recording on stream interruption
- Stream cancellation as distinct status (vs success vs error)
- Backpressure detection (consumer slower than provider)
- Chunk-level events or metrics

## Research plan

Deep dive into:

- How OpenAI, Anthropic, Gemini handle streaming metadata differently
- What existing tools (OpenLLMetry, Langfuse, Helicone) track for streaming
- OTel spec guidance on long-running spans and streaming
- Real-world streaming failure modes (timeouts, partial responses, rate limits mid-stream)

---

## Article angle (TBD after research)

Likely: "Every LLM SDK returns `stream: true` differently. Here's what breaks when you try to trace it — and what metrics actually matter."

---

## Cross-references

- Article #3 comment that sparked this: streaming span attribute question
- Current implementation: `packages/instrumentation/src/instrumentations/create.ts`
- Article #1: origin story
- Article #2: audit (streaming path was broken)
- Article #3: OTel semconv
