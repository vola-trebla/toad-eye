# 🐸👁️ toad-eye — Product Backlog

## From npm package to production-ready AI observability platform

---

## How to read this document

**Epic** — крупная область работы, объединённая общей целью.
**Story** — конкретная задача внутри эпика. Формат: что делаем и зачем.
**Acceptance Criteria** — когда story считается завершённой.
**TOAD Integration** — как story связана с другими модулями экосистемы.

Приоритеты:

- 🔴 **Critical** — без этого продукт не жизнеспособен
- 🟡 **Important** — значительно усиливает продукт
- 🟢 **Nice-to-have** — делаем когда основа готова

---

## Epic 1: Zero-Friction Developer Experience (DX)

> **Цель:** Любой разработчик получает работающий observability stack за 2 минуты без чтения документации.
>
> **Почему первый:** Текущая боль — даже автор (Albert) испытывал трудности при интеграции toad-eye в свой проект. Если автору больно — юзеру невозможно. Конкуренты Helicone и OpenLLMetry побеждают именно за счёт low-friction onboarding.

### Story 1.1: Auto-instrumentation для LLM SDK 🔴

Реализовать monkey-patching популярных LLM SDK, чтобы юзеру не нужно было вручную оборачивать каждый вызов в `traceLLMCall()`.

**Поддерживаемые SDK (в порядке приоритета):**

- OpenAI (`openai` npm package)
- Anthropic (`@anthropic-ai/sdk`)
- Google GenAI (`@google/generative-ai`)
- Vercel AI SDK (`ai`)

**Целевой API:**

```typescript
import { initObservability } from 'toad-eye';

initObservability({
  serviceName: 'my-app',
  instrument: ['openai', 'anthropic', '@google/generative-ai']
});

// Всё. Никаких обёрток. Каждый вызов автоматически трейсится.
const result = await openai.chat.completions.create({ ... });
```

**Acceptance Criteria:**

- [ ] OpenAI SDK auto-instrumented: все вызовы `chat.completions.create()` и `embeddings.create()` создают spans автоматически
- [ ] Anthropic SDK auto-instrumented: `messages.create()` создаёт spans
- [ ] Google GenAI auto-instrumented: `generateContent()` создаёт spans
- [ ] Span attributes включают: provider, model, prompt (опционально), completion (опционально), input_tokens, output_tokens, cost, latency, status
- [ ] `recordContent: false` отключает запись prompt/completion (privacy mode)
- [ ] Ручной `traceLLMCall()` продолжает работать для кастомных провайдеров
- [ ] Zero performance overhead когда toad-eye не инициализирован

**Архитектурные решения:**

- Использовать паттерн из agentic-tool-router: pluggable registry для provider instrumentations
- Каждый provider — отдельный файл в `instrumentations/` (как tools в agent)
- Monkey-patch на уровне prototype методов SDK, не proxy

**TOAD Integration:** Метрики auto-instrumentation (какие SDK обнаружены, сколько вызовов перехвачено) доступны через `toad_system_status` в toad-mcp.

---

### Story 1.2: "2-Minute Test" — безболезненный onboarding 🔴

Весь путь от `npm install` до "вижу данные в Grafana" должен занимать ≤ 2 минут.

**Целевой flow:**

```bash
npm install toad-eye
npx toad-eye init        # создаёт infra/ с docker-compose и конфигами
npx toad-eye up          # поднимает Grafana + Prometheus + Jaeger + OTel Collector
npx toad-eye demo        # запускает mock LLM service с тестовым трафиком
# Открой localhost:3100 → данные уже в Grafana
```

**Acceptance Criteria:**

- [ ] `npx toad-eye init` работает без ошибок на чистой машине (macOS, Linux)
- [ ] `npx toad-eye up` поднимает стек без ручного редактирования конфигов
- [ ] `npx toad-eye demo` генерирует тестовые данные для всех метрик
- [ ] Grafana открывается с pre-configured дашбордом, данные видны сразу
- [ ] `npx toad-eye status` показывает здоровье всех сервисов
- [ ] `npx toad-eye down` чисто останавливает всё
- [ ] Весь flow прогнан на чистой Ubuntu 24, macOS Sonoma — проходит за ≤ 2 мин (без учёта docker pull)

**Замечание:** Прогнать flow на 3 чистых окружениях и записать каждый friction point.

---

### Story 1.3: Переписать README — Quick Start в 5 строк 🔴

README должен продавать за 10 секунд. Текущий README функционален, но не "wow".

**Структура нового README:**

1. Hero: одна строка — что это и зачем
2. GIF: демо от init до Grafana за 30 секунд
3. Quick Start: 5 строк кода, copy-paste и работает
4. Screenshot: Grafana дашборд с реальными данными
5. Features: таблица возможностей
6. Metrics: что трекается
7. Architecture: mermaid-диаграмма (уже есть, хорошая)
8. Advanced: auto-instrumentation, privacy mode, HTTP transport

**Acceptance Criteria:**

- [ ] GIF записан (терминал: init → up → demo → Grafana с данными)
- [ ] Quick Start — максимум 5 строк до первого результата
- [ ] Скриншот Grafana обновлён с актуальными данными
- [ ] Добавлены badges: npm version, downloads, CI, license
- [ ] README проверен на свежий взгляд (показать кому-то кто не знает проект)

---

### Story 1.4: OTel GenAI Semantic Conventions 🟡

Привести span attributes в соответствие с OpenTelemetry GenAI semantic conventions (OTel v1.40+). Это стандарт индустрии 2026, без него toad-eye не совместим с другими OTel backends.

**Текущее состояние:** Кастомные attribute names (`llm.provider`, `llm.model`, etc.)
**Целевое состояние:** OTel GenAI semconv (`gen_ai.system`, `gen_ai.request.model`, `gen_ai.usage.input_tokens`, etc.)

**Acceptance Criteria:**

- [ ] Все span attributes соответствуют OTel GenAI semantic conventions
- [ ] Переход от span events к log-based events для prompt/completion data (OTel deprecation)
- [ ] Backward compatibility: старые attribute names работают через aliasing в переходный период
- [ ] Grafana дашборды обновлены под новые attribute names
- [ ] Документация описывает mapping старых → новых attributes

**Источник:** OpenTelemetry Semantic Conventions for GenAI (opentelemetry.io/docs/specs/semconv/gen-ai/)

---

### Story 1.5: Privacy & Security Controls 🟡

Разработчики в корпоративной среде не могут отправлять содержимое промптов во внешние системы. Нужны гранулярные контролы.

**Acceptance Criteria:**

- [ ] `recordContent: false` — полностью отключает запись prompt/completion в spans
- [ ] `redactPatterns: [/email/i, /ssn/i]` — regex-based redaction конкретных паттернов
- [ ] `hashContent: true` — записывает SHA-256 хэш вместо текста (можно сравнивать промпты без чтения)
- [ ] Все privacy settings применяются ДО отправки данных в OTel Collector
- [ ] Документация описывает compliance considerations (GDPR, SOC2)

---

## Epic 2: Multi-Provider Intelligence

> **Цель:** Единая картина по всем LLM-провайдерам. Сравнение, аналитика, рекомендации.
>
> **Почему важно:** El Sapo Cripto использует Gemini Flash, Flash-Lite и Pro для разных задач. Реальные приложения работают с 2-5 провайдерами. Ни один из конкурентов не даёт простого multi-provider сравнения в одном дашборде.

### Story 2.1: Pre-built Grafana Dashboard Suite 🔴

Набор готовых дашбордов, а не один общий. Каждый отвечает на конкретный вопрос.

**Дашборды:**

1. **Overview** — общие метрики: total requests, error rate, avg latency, total cost. Фильтр по provider/model.
2. **Cost Breakdown** — расходы по provider, model, endpoint. Daily/weekly тренд. Projected monthly spend.
3. **Latency Analysis** — p50, p95, p99 по моделям. Latency distribution histogram. Slow requests drill-down.
4. **Error Drill-down** — error rate по типам (timeout, rate_limit, invalid_response, validation_failure). Timeline + recent errors.
5. **Model Comparison** — side-by-side: latency vs cost vs error rate для разных моделей на одном графике.

**Acceptance Criteria:**

- [ ] 5 дашбордов автоматически provisioned при `npx toad-eye init`
- [ ] Каждый дашборд имеет переменные для фильтрации (provider, model, time range)
- [ ] Model Comparison дашборд показывает scatter plot: cost vs latency per model
- [ ] Все дашборды работают с данными из demo (`npx toad-eye demo`)
- [ ] Скриншоты каждого дашборда в документации

---

### Story 2.2: Cost Attribution Engine 🟡

Точное вычисление стоимости каждого LLM-вызова в реальном времени.

**Acceptance Criteria:**

- [ ] Встроенная таблица цен для основных моделей (GPT-4o, GPT-4o-mini, Claude Sonnet/Haiku/Opus, Gemini Flash/Pro)
- [ ] Cost рассчитывается автоматически на основе input_tokens + output_tokens + model
- [ ] CLI команда для обновления таблицы цен: `npx toad-eye update-pricing`
- [ ] Пользователь может переопределить цены (custom models, enterprise contracts)
- [ ] Cost записывается как span attribute и как Prometheus metric
- [ ] Grafana дашборд "Cost Breakdown" использует эти данные

**TOAD Integration:** toad-ci может запрашивать "средняя стоимость этого промпта в проде за 7 дней" для baseline comparison.

---

### Story 2.3: Provider Health Monitoring 🟡

Мониторинг здоровья самих LLM-провайдеров, а не только приложения.

**Acceptance Criteria:**

- [ ] Отдельная Grafana панель: status по каждому провайдеру (healthy / degraded / down)
- [ ] Автоматическое определение: rate_limit errors > 10% за 5 мин = "degraded"
- [ ] Автоматическое определение: timeout errors > 50% за 1 мин = "down"
- [ ] Историческая доступность: uptime % за 24h / 7d / 30d
- [ ] Webhook alert при переходе в degraded/down

---

## Epic 3: Session & Conversation Tracking

> **Цель:** Группировка трейсов в логические сессии. Понимание как качество и стоимость меняются в ходе разговора.
>
> **Почему важно:** Gemini research выявил session-level grouping как gap у всех конкурентов кроме Langfuse. Multi-turn conversations — основной паттерн использования LLM в 2026 (chatbots, agents). Без session tracking невозможно понять user experience.

### Story 3.1: Session Correlation 🟡

Автоматическая группировка traces по session ID.

**API:**

```typescript
initObservability({
  serviceName: "my-app",
  sessionExtractor: (context) => context.headers["x-session-id"],
  // или автоматически из стандартных headers
});
```

**Acceptance Criteria:**

- [ ] Юзер может передать sessionId через API или header
- [ ] Все spans одной сессии линкуются через общий trace attribute `session.id`
- [ ] Grafana: фильтрация по session ID, просмотр всех вызовов одной сессии
- [ ] Jaeger: группировка spans по session
- [ ] Метрики: avg session length, avg session cost, avg turns per session

---

### Story 3.2: Conversation Quality Degradation Tracking 🟢

Отслеживание как меняется качество ответов в ходе длинной сессии.

**Acceptance Criteria:**

- [ ] Метрика: response latency per turn number (растёт ли latency к концу разговора?)
- [ ] Метрика: token usage per turn (растёт ли контекст?)
- [ ] Метрика: cost per turn (как накапливается стоимость?)
- [ ] Grafana панель: "Session Quality" — графики этих метрик по оси turn number
- [ ] Alert: "средняя стоимость turn > $X" или "session length > Y turns"

---

## Epic 4: Agentic Observability

> **Цель:** Глубокая видимость в работу AI-агентов: ReAct loops, tool calls, multi-step reasoning.
>
> **Почему важно:** Gemini research показал, что Jaeger (линейные timelines) не справляется с визуализацией ветвящихся, циклических агентных workflows. Это top gap у Helicone. Agentic-tool-router уже реализует ReAct pattern — toad-eye должен это визуализировать.

### Story 4.1: Agent Step Tracking 🟡

Структурированная запись шагов агента: think → act → observe → repeat.

**API:**

```typescript
import { traceAgentStep } from "toad-eye";

// Внутри agent loop
traceAgentStep({
  type: "think", // think | act | observe | answer
  content: "I need to check asteroid data",
  toolUsed: null,
  stepNumber: 1,
});

traceAgentStep({
  type: "act",
  content: "Calling near-earth-asteroids tool",
  toolUsed: "near-earth-asteroids",
  stepNumber: 2,
});
```

**Acceptance Criteria:**

- [ ] Agent steps записываются как child spans внутри parent agent span
- [ ] Каждый step имеет атрибуты: type, content, tool_used, step_number
- [ ] Метрики: avg steps per query, tool usage frequency, think-to-answer ratio
- [ ] Jaeger: agent trace показывает иерархию steps
- [ ] Полная совместимость с OTel GenAI agent span conventions

**TOAD Integration:** toad-agent (agentic-tool-router) — первый клиент этой фичи. Реализовать и протестировать на NASA agent.

---

### Story 4.2: Tool Usage Analytics 🟢

Аналитика по использованию tools агентами.

**Acceptance Criteria:**

- [ ] Grafana панель: какие tools вызываются чаще всего
- [ ] Grafana панель: avg latency per tool
- [ ] Grafana панель: tool error rate
- [ ] Grafana панель: correlation — какие tools чаще вызываются вместе
- [ ] Метрика: "tools per query" — сколько tools агент вызывает в среднем

---

### Story 4.3: Reasoning Trace для Thinking Models 🟢

Специальная поддержка моделей с "thinking" (o1/o3, Gemini с thinking, Claude с extended thinking).

**Acceptance Criteria:**

- [ ] Reasoning trace (thinking content) записывается как отдельный span event type
- [ ] Privacy: thinking content redactable отдельно от prompt/completion
- [ ] Метрика: thinking_tokens vs output_tokens ratio
- [ ] Jaeger: thinking trace отображается как expandable block

---

## Epic 5: Alerting & Anomaly Detection

> **Цель:** Проактивное обнаружение проблем до того как их заметят пользователи.
>
> **Почему важно:** El Sapo инцидент — runaway Gemini Flash costs, обнаружен постфактум. С алертами обнаружили бы за минуты. Это реальная боль, пережитая лично.

### Story 5.1: Cost Alerts 🔴

Threshold-based алерты при росте затрат.

**Acceptance Criteria:**

- [ ] Конфигурация через YAML или API:
  ```yaml
  alerts:
    - name: cost_spike
      metric: llm.request.cost
      condition: sum_1h > 10 # $10 за час
      channels: [telegram, slack_webhook]
    - name: budget_daily
      metric: llm.request.cost
      condition: sum_24h > 50 # $50 за день
      channels: [telegram]
  ```
- [ ] Каналы доставки: Telegram bot, Slack webhook, generic HTTP webhook, email (через SMTP)
- [ ] Алерт включает: какая метрика, текущее значение, threshold, top model/endpoint по расходу
- [ ] Cooldown period: не спамить алертами (настраиваемый, default 30 min)
- [ ] Grafana: алерты отображаются на Cost дашборде как annotations

**Источник вдохновения:** El Sapo budget tracker — `canMakeRequest()` guard + Telegram alert at 40/50 calls.

---

### Story 5.2: Latency Anomaly Detection 🟡

Обнаружение аномальных скачков latency.

**Acceptance Criteria:**

- [ ] Baseline: rolling average p95 latency за 7 дней
- [ ] Alert: p95 вырос на > 50% от baseline
- [ ] Alert: конкретный provider/model latency вырос на > 100%
- [ ] Grafana: аномалии отображаются как markers на Latency дашборде

---

### Story 5.3: Error Rate Alerts 🟡

Алерты при росте error rate.

**Acceptance Criteria:**

- [ ] Alert: error rate > 5% за 15 минут (по любому provider)
- [ ] Alert: error rate > 20% за 5 минут (критический — возможно provider down)
- [ ] Разделение по типам: rate_limit, timeout, server_error, validation_error
- [ ] Grafana: error bursts видны на Error Drill-down дашборде

---

## Epic 6: Semantic Quality Monitoring

> **Цель:** Обнаружение "тихой деградации" — когда модель отвечает 200 OK, но качество ответов падает.
>
> **Почему важно:** Gemini research назвал это "Silent Drift" и выделил как уникальную инновацию, отсутствующую у всех конкурентов. Traditional monitoring не ловит семантическую деградацию. Это killer feature toad-eye.

### Story 6.1: Semantic Drift Monitoring 🟡

Мониторинг смещения распределения ответов модели от baseline.

**Как работает:**

1. При сохранении baseline, toad-eye генерирует embeddings для типичных ответов
2. В проде, периодически (каждые N запросов) генерирует embedding текущего ответа
3. Вычисляет cosine distance между текущим и baseline embedding
4. Если средний drift > threshold → alert "Semantic Drift Detected"

**Acceptance Criteria:**

- [ ] CLI: `npx toad-eye baseline:save` — сохраняет embeddings текущих production responses
- [ ] Метрика: `llm.semantic_drift` — rolling average cosine distance от baseline
- [ ] Alert: drift > configurable threshold (default 0.3)
- [ ] Grafana: "Semantic Health" панель — drift over time, per model/endpoint
- [ ] Embedding provider configurable (OpenAI embeddings, local model, etc.)

**TOAD Integration:** При обнаружении drift → автоматический trigger toad-eval для проверки регрессии.

---

### Story 6.2: Response Quality Proxy Metrics 🟢

Метрики-заменители качества, которые не требуют embeddings.

**Acceptance Criteria:**

- [ ] `llm.response.length` — средняя длина ответа (резкое сокращение = проблема)
- [ ] `llm.response.refusal_rate` — % ответов содержащих "I cannot", "I'm sorry" patterns
- [ ] `llm.response.json_validity` — % ответов с валидным JSON (для structured output)
- [ ] `llm.response.language_consistency` — % ответов на ожидаемом языке
- [ ] Grafana: "Response Quality" панель с этими метриками
- [ ] Alerts на аномальные изменения каждой метрики

**TOAD Integration:** `llm.response.json_validity` напрямую связан с toad-guard — если validity падает, guardrails делают больше ретраев.

---

## Epic 7: TOAD Ecosystem Integration

> **Цель:** toad-eye как центральный нервный узел экосистемы TOAD. Данные из toad-eye питают все остальные модули.
>
> **Почему важно:** Это главный дифференциатор TOAD от конкурентов. Langfuse — standalone. TOAD — ecosystem. Quality lifecycle loop.

### Story 7.1: Trace-to-Dataset Export (toad-eval) 🟡

Экспорт production trace в toad-eval test case одним действием.

**Flow:**

```
Проблемный trace в Jaeger/Grafana
  → Кнопка "Export to toad-eval"
    → Генерирует YAML test case:
        - input: [prompt из trace]
        - expected assertions: [на основе successful baseline]
        - metadata: [trace_id, timestamp, model]
  → Test case добавляется в eval suite
  → Следующий toad-ci run включает этот кейс
```

**Acceptance Criteria:**

- [ ] CLI: `npx toad-eye export-trace <trace_id> --format toad-eval`
- [ ] Экспорт генерирует валидный YAML в формате toad-eval
- [ ] Автоматическое создание assertions на основе successful response patterns
- [ ] Batch export: экспорт всех traces matching filter за период

**TOAD Integration:** Прямая связка toad-eye → toad-eval → toad-ci. Production failure → test case → CI gate.

---

### Story 7.2: Guardrails Shadow Mode (toad-guard) 🟡

toad-guard работает в "shadow mode" через toad-eye: не блокирует ответы, а записывает метрики "что было бы заблокировано".

**Acceptance Criteria:**

- [ ] toad-guard API: `mode: 'shadow'` — валидирует но не блокирует
- [ ] toad-eye записывает: `guard.would_block: true/false`, `guard.failure_reason`, `guard.rule_name`
- [ ] Grafana: "Shadow Guardrails" панель:
  - Potential Block Rate (% ответов которые были бы заблокированы)
  - Top block reasons
  - Block rate trend (помогает тюнить пороги)
- [ ] Alert: potential block rate > X% (значит guardrails слишком агрессивные или модель деградировала)

**Источник:** Gemini research — "Shadow Guardrails" как уникальная инновация TOAD.

---

### Story 7.3: CI Baseline Provider (toad-ci) 🟡

toad-eye предоставляет production baselines для toad-ci.

**Acceptance Criteria:**

- [ ] API endpoint: `GET /baselines?prompt={name}&period=7d`
- [ ] Возвращает: avg latency, p95 latency, avg cost, avg tokens, error rate за период
- [ ] toad-ci использует эти данные вместо локальных baselines
- [ ] Если production p95 latency = 800ms, а новый промпт даёт 2000ms → CI fails

**TOAD Integration:** toad-ci перестаёт быть "изолированным" — теперь quality gates основаны на реальных production метриках.

---

### Story 7.4: MCP Live Queries (toad-mcp) 🟢

Разработчик в Claude Desktop может запрашивать live данные из toad-eye.

**Примеры запросов:**

- "Покажи последние failing traces для checkout-agent"
- "Какой средний cost для summarization промпта за неделю?"
- "Сравни latency GPT-4o vs Claude Sonnet за последние 24h"

**Acceptance Criteria:**

- [ ] toad-mcp tool: `toad_query_metrics` — произвольный запрос к toad-eye API
- [ ] toad-mcp tool: `toad_recent_errors` — последние N ошибок с контекстом
- [ ] toad-mcp tool: `toad_compare_models` — side-by-side comparison метрик

---

## Epic 8: FinOps & Cost Optimization

> **Цель:** toad-eye как инструмент экономии денег, а не только мониторинга.
>
> **Почему важно:** Gemini research: "Phase 3 transforms toad-eye from a purely technical tool into a business-critical cost management asset." Стартапы считают каждый доллар. Показать "сэкономлено $X" — лучший sales аргумент.

### Story 8.1: FinOps Attribution Dashboard 🟡

Разбивка расходов по бизнес-измерениям.

**Acceptance Criteria:**

- [ ] Cost breakdown по: provider, model, endpoint/feature, user_id (если передан), team/tag
- [ ] Daily / weekly / monthly trends
- [ ] "Projected monthly spend" на основе текущего темпа
- [ ] "What-if" панель: "если перевести 50% трафика с GPT-4o на Flash — экономия $X/мес"
- [ ] Export в CSV для финансового отдела

---

### Story 8.2: Budget Guards (Runtime) 🟡

Предотвращение budget overrun прямо в рантайме. Вдохновлено El Sapo `canMakeRequest()` guard.

**API:**

```typescript
initObservability({
  serviceName: "my-app",
  budgets: {
    daily: 50, // $50/день max
    perUser: 5, // $5 на юзера в день
    perModel: {
      "gpt-4o": 30, // $30/день на GPT-4o
    },
  },
  onBudgetExceeded: "warn" | "block" | "downgrade",
  // warn = log + alert
  // block = throw error
  // downgrade = switch to cheaper model (requires callback)
});
```

**Acceptance Criteria:**

- [ ] Budget tracking in-memory с periodic persistence
- [ ] `onBudgetExceeded: 'warn'` — продолжает работу, шлёт alert
- [ ] `onBudgetExceeded: 'block'` — throws ToadBudgetExceededError
- [ ] `onBudgetExceeded: 'downgrade'` — вызывает user-defined callback для fallback модели
- [ ] Budget reset: daily at midnight UTC (configurable)
- [ ] Grafana: budget usage % панель с visual threshold

**TOAD Integration:** Связка с toad-guard — если budget exceeded и mode = 'downgrade', toad-guard автоматически перевалидирует output от cheaper модели.

---

### Story 8.3: Semantic Cache Integration (toad-cache) 🟢

Интеграция с будущим toad-cache модулем для отслеживания экономии от кэширования.

**Acceptance Criteria:**

- [ ] Метрики: cache hit rate, cache miss rate, avoided_cost ($ сэкономлено на cache hits)
- [ ] Span attribute: `cache.hit: true/false`, `cache.similarity_score`
- [ ] Grafana: "Cache Efficiency" панель — hit rate trend, cumulative savings
- [ ] toad-eye не зависит от toad-cache — только записывает метрики если cache headers присутствуют

---

## Epic 9: Cloud-Ready Architecture

> **Цель:** Подготовка toad-eye к hosted cloud-версии (toad.dev).
>
> **Почему важно:** Self-hosted Docker stack — барьер для многих. Cloud-версия: `apiKey` вместо Docker. Это путь к монетизации.

### Story 9.1: HTTP Ingestion Endpoint 🟡

Standalone HTTP endpoint для приёма telemetry без локального OTel Collector.

**Acceptance Criteria:**

- [ ] `POST /v1/traces` — приём OTLP-formatted data
- [ ] `POST /v1/metrics` — приём метрик
- [ ] API key authentication: `Authorization: Bearer toad_xxxxx`
- [ ] Rate limiting per API key
- [ ] Валидация payload с понятными ошибками
- [ ] Hono-based, deployable на Railway/Fly.io

---

### Story 9.2: Cloud-mode SDK configuration 🟡

Юзер может отправлять данные в toad-eye cloud одной строкой.

**Целевой API:**

```typescript
initObservability({
  serviceName: "my-app",
  apiKey: "toad_xxxxxxxx", // вместо endpoint
  instrument: ["openai"],
});
// Всё. Никакого Docker, OTel Collector, Grafana.
// Данные видны на toad-eye.dev/dashboard
```

**Acceptance Criteria:**

- [ ] `apiKey` автоматически переключает transport на HTTPS endpoint
- [ ] Fallback: если cloud недоступен — buffer locally, retry
- [ ] Все существующие features работают идентично в cloud mode
- [ ] Self-hosted mode остаётся default и бесплатным навсегда

---

### Story 9.3: Web Dashboard (замена Grafana для cloud) 🟢

Собственный дашборд для cloud-юзеров вместо self-hosted Grafana.

**Acceptance Criteria:**

- [ ] React SPA с основными визуализациями: overview, cost, latency, errors
- [ ] Real-time обновление
- [ ] Trace viewer (замена Jaeger)
- [ ] Auth: magic link или GitHub OAuth
- [ ] Mobile-friendly (основные метрики видны с телефона)

---

## Epic 10: Community & Ecosystem Growth

> **Цель:** toad-eye находят, ставят, и рассказывают другим.
>
> **Почему важно:** Без community open-source проект мёртв. Ни один конкурент не создавался без DevRel-активности.

### Story 10.1: Launch Article 🔴

"I built an open-source LLM observability tool after my AI bot burned through my API budget"

**Содержание:**

- El Sapo Cripto — что это, как работает
- Инцидент: Gemini Flash runaway costs, Railway restarts, in-memory budget reset
- Как это привело к toad-eye
- Что toad-eye делает + demo
- Open source, npm install, try it

**Acceptance Criteria:**

- [ ] Статья написана на английском
- [ ] Опубликована на Dev.to
- [ ] Запощена на Reddit: r/node, r/typescript, r/LLM, r/SaaS
- [ ] Submitted на Hacker News (Show HN)
- [ ] X/Twitter тред с ключевыми моментами + GIF

---

### Story 10.2: Product Hunt Launch 🟡

Подготовка и запуск на Product Hunt.

**Acceptance Criteria:**

- [ ] Tagline: "The frog that watches your LLMs 🐸👁️"
- [ ] Description: 280 chars
- [ ] 5 screenshots/GIFs: init flow, Grafana dashboard, auto-instrumentation code, Jaeger traces, terminal demo
- [ ] Maker comment подготовлен
- [ ] Выбран день запуска (вторник-четверг, не в праздники)
- [ ] 10+ hunter'ов ready to upvote at launch

---

### Story 10.3: Landing Page (toad-eye.ai / toad.dev) 🟡

Одностраничный лендинг.

**Acceptance Criteria:**

- [ ] Hero: "LLM Observability in 3 Commands" + terminal animation
- [ ] Features section: 4-6 ключевых capabilities с иконками
- [ ] Screenshot: Grafana дашборд
- [ ] Code snippet: Quick Start
- [ ] TOAD ecosystem section: ссылки на toad-guard, toad-eval, toad-ci
- [ ] Footer: GitHub, npm, X/Twitter, "Built by @жаба_бро"
- [ ] Домен: toad-eye.ai или toad-eye.com или toad.dev
- [ ] Hosted: Vercel (бесплатно)

---

### Story 10.4: Documentation Site 🟡

Полная документация за пределами README.

**Acceptance Criteria:**

- [ ] Платформа: Starlight (Astro) или Docusaurus
- [ ] Разделы: Getting Started, Auto-instrumentation Guide, Metrics Reference, Grafana Dashboards, Configuration, FAQ, TOAD Ecosystem
- [ ] Каждый раздел с code examples
- [ ] Search работает
- [ ] Hosted: docs.toad-eye.ai или toad-eye.ai/docs

---

## Summary: Story Count by Priority

| Priority        | Count  | Описание                                 |
| --------------- | ------ | ---------------------------------------- |
| 🔴 Critical     | 5      | DX foundation + alerts + launch article  |
| 🟡 Important    | 16     | Core features + integrations + community |
| 🟢 Nice-to-have | 7      | Advanced features + future modules       |
| **Total**       | **28** |                                          |

## Рекомендуемый порядок работы

```
Batch 1 (Foundation):
  1.1 Auto-instrumentation     🔴
  1.2 2-Minute Test            🔴
  1.3 README rewrite           🔴
  2.1 Grafana Dashboard Suite  🔴
  5.1 Cost Alerts              🔴

Batch 2 (Launch):
  10.1 Launch Article          🔴
  10.3 Landing Page            🟡
  10.2 Product Hunt Launch     🟡
  10.4 Documentation Site      🟡

Batch 3 (Depth):
  1.4 OTel GenAI Conventions   🟡
  1.5 Privacy Controls         🟡
  2.2 Cost Attribution         🟡
  3.1 Session Correlation      🟡
  5.2 Latency Anomalies        🟡
  5.3 Error Rate Alerts        🟡

Batch 4 (Ecosystem):
  7.1 Trace-to-Dataset         🟡
  7.2 Shadow Guardrails        🟡
  7.3 CI Baseline Provider     🟡
  7.4 MCP Live Queries         🟢
  4.1 Agent Step Tracking      🟡
  6.1 Semantic Drift           🟡

Batch 5 (Monetization):
  8.1 FinOps Dashboard         🟡
  8.2 Budget Guards            🟡
  9.1 HTTP Ingestion           🟡
  9.2 Cloud-mode SDK           🟡
  9.3 Web Dashboard            🟢

Batch 6 (Advanced):
  2.3 Provider Health          🟡
  3.2 Conversation Degradation 🟢
  4.2 Tool Usage Analytics     🟢
  4.3 Reasoning Traces         🟢
  6.2 Response Quality Proxy   🟢
  8.3 Semantic Cache           🟢
```

---

_🐸👁️ toad-eye — The frog that watches your LLMs_

_Document version: 1.0 | March 18, 2026_
