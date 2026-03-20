# toad-eye: Architectural Debt & Engineering Roadmap

Technical limitations, security gaps, and improvements identified during code review.

Tracked in GitHub Issues: #92, #93, #94.

---

## Critical: Security & Data Privacy

### 1. PII Leakage in Error Messages (#92)

**Problem:** `traceLLMCall` records error messages in `gen_ai.toad_eye.error` span attribute. LLM providers often include prompt fragments or user data in error messages (e.g., "Rate limit for user john@example.com exceeded"). Privacy controls (`redactPatterns`, `hashContent`, `recordContent: false`) are applied to prompts and completions but **not** to error messages in `setErrorAttributes`.

**Impact:** GDPR/SOC2 compliance risk — PII leaks into traces even when privacy is configured.

**Fix:** Apply `processContent()` to error messages before recording in spans. Respect the same `recordContent` / `redactPatterns` / `hashContent` pipeline.

### 2. Weak Content Hashing (No Salt)

**Problem:** `hashContent` uses plain SHA-256 without a salt. Short, common LLM responses ("Yes", "No", "I don't know") are trivially reversible via rainbow tables.

**Impact:** Low-to-Medium. Privacy feature gives false sense of security for low-entropy strings.

**Fix:** Add optional `privacy.salt` to `ToadEyeConfig`. When set, prepend salt before hashing: `sha256(salt + text)`.

---

## Critical: Missing Functionality

### 3. Streaming Observability Gap (#93)

**Problem:** Auto-instrumentations for OpenAI and Anthropic explicitly skip calls where `stream: true`. Since most production LLM interactions use streaming for UX, toad-eye is blind to the majority of real-world traffic — no traces, no metrics, no cost tracking.

**Impact:** Critical. The tool doesn't observe what matters most in production.

**Fix:** Wrap the returned `AsyncIterable`/`Stream` object. Intercept chunks as they arrive, accumulate token counts from `usage` fields in the final chunk, record span on stream completion. Key challenge: the span must stay open until the stream ends.

### 4. Multi-Modal Parsing Fragility

**Problem:** `extractMessages` in `openai.ts` and `gemini.ts` assumes `content` is always a `string`. Modern SDKs use `ContentPart[]` arrays for images, audio, and tool calls. Current implementation silently returns empty strings for multi-modal inputs.

**Impact:** Inaccurate traces for Vision and Audio models — prompts show as empty.

**Fix:** Handle `Array<ContentPart>` — extract text parts, record image/audio as `[image]`/`[audio]` placeholders.

---

## Performance & Scalability

### 5. Synchronous Drift Monitoring (#94)

**Problem:** `cosineSimilarity` runs in a loop over the entire baseline dataset on the main Node.js thread. O(N \* D) complexity where N = baseline size, D = embedding dimensions (typically 1536).

**Impact:** Large baselines (1k+ vectors) will block the event loop, causing latency spikes for all concurrent requests.

**Fix options:**

- **Short term:** Run drift check as fire-and-forget (don't await, catch errors silently). Already partially done via `sampleRate` but computation itself still blocks.
- **Medium term:** Move to Worker Thread via `worker_threads` module.
- **Long term:** Native SIMD bindings or WASM for vector math.

### 6. Double-Processing with Redact + Hash

**Problem:** When both `redactPatterns` and `hashContent` are enabled, the library runs all regex replacements and then immediately hashes the result, discarding the redacted text.

**Impact:** Minor. Extra CPU cycles but negligible for typical prompt sizes. Code smell more than a real performance issue.

**Fix:** Skip redaction when `hashContent` is enabled — hashing already obscures content.

---

## Architectural Debt

### 7. Initialization Guard Incomplete

**Problem:** `initObservability` has `if (sdk) return;` which prevents double SDK init. However, `enableAll()` in the instrumentation registry could be called multiple times if the guard is bypassed, potentially double-patching SDK methods.

**Impact:** Low. Won't crash but could cause duplicated spans in edge cases (hot module reload, test teardown issues).

**Fix:** Add `initialized` guard in `enableAll()` itself, not just in `initObservability`.

### 8. Drift Monitoring Costs Not Budgeted

**Problem:** Semantic drift monitoring calls the OpenAI Embeddings API for each checked response, but these calls are invisible to `BudgetTracker`. Users can exceed their API budget from "monitoring" alone without knowing.

**Impact:** Medium. FinOps blind spot — monitoring costs not tracked or capped.

**Fix:** Route embedding API calls through the same cost tracking, or at minimum expose `drift.apiCallCount` / `drift.estimatedCost` in the monitor stats.

### 9. In-Memory Server Storage (MVP Limitation)

**Problem:** `packages/server` stores all ingested telemetry in memory. Server restart = all data lost. Memory grows unbounded until the 10k cap triggers eviction.

**Impact:** Not a bug — conscious MVP decision. But blocks production cloud deployment.

**Fix (future):** SQLite for single-node, PostgreSQL/ClickHouse for cloud. The `MemoryStore` interface is already clean enough to swap.

### 10. Cloud Mode: No Retry Buffer

**Problem:** When `apiKey` is set (cloud mode), the SDK relies on OTel SDK's built-in retry. There's no local buffer — if the cloud endpoint is down, telemetry is silently dropped.

**Impact:** Medium. Data loss during cloud outages or network issues.

**Fix (future):** Bounded in-memory queue with exponential backoff retry. Drain on shutdown.

---

## Priority Roadmap

### Phase 1: Security (immediate)

- [ ] #92 — Apply `processContent` to error messages in spans
- [ ] Add salted hashing option for `hashContent`
- [ ] Handle multi-modal `ContentPart[]` in message extractors

### Phase 2: Feature parity (next batch)

- [ ] #93 — Streaming support for OpenAI/Anthropic auto-instrumentation
- [ ] #94 — Off-thread drift monitoring (Worker Thread)

### Phase 3: Production hardening

- [ ] Persistent storage for server (SQLite → PostgreSQL)
- [ ] Cloud mode retry buffer with backoff
- [ ] Drift monitoring cost tracking in BudgetTracker
- [ ] Initialization guard in instrumentation registry

---

_"Observability is only as good as its blind spots are small."_
