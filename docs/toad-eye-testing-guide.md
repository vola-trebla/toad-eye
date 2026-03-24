# 🐸👁️ toad-eye — Полный гайд по ручному тестированию

## Цель: пощупать руками ВСЁ что мы сделали

---

## Подготовка

### 1. Чистая директория

```bash
mkdir toad-eye-test && cd toad-eye-test
npm init -y
npm install toad-eye
```

### 2. Поднять стек

```bash
npx toad-eye init
npx toad-eye up
npx toad-eye status   # убедись что всё зелёное
```

**Проверь:**

- [ ] `npx toad-eye init` создал папку `infra/toad-eye/`
- [ ] `npx toad-eye up` показал сообщение про Docker images на первом запуске
- [ ] `npx toad-eye status` показывает все сервисы running
- [ ] http://localhost:3100 — Grafana открывается (admin/admin)
- [ ] http://localhost:16686 — Jaeger UI открывается
- [ ] http://localhost:9090 — Prometheus открывается

---

## Кейс 1: Auto-instrumentation (без ручных обёрток)

**Что проверяем:** toad-eye автоматически перехватывает вызовы LLM SDK.

### Создай файл `test-auto.ts`:

```typescript
import { initObservability } from "toad-eye";

// Инициализация — одна строка, без traceLLMCall
initObservability({
  serviceName: "test-auto-instrumentation",
  endpoint: "http://localhost:4318",
  instrument: ["gemini"], // auto-patch Gemini SDK
});

import { GoogleGenerativeAI } from "@google/generative-ai";

const genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const model = genai.getGenerativeModel({ model: "gemini-2.0-flash-lite" });

async function main() {
  console.log("🐸 Тест 1: Auto-instrumentation\n");

  // Вызов 1 — простой запрос
  const result1 = await model.generateContent('Скажи "привет" одним словом');
  console.log("Ответ 1:", result1.response.text());

  // Вызов 2 — ещё один запрос (чтобы были данные для сравнения)
  const result2 = await model.generateContent(
    "Назови 3 планеты солнечной системы",
  );
  console.log("Ответ 2:", result2.response.text());

  // Вызов 3 — длинный запрос (больше токенов → видно на cost графике)
  const result3 = await model.generateContent(
    "Напиши параграф о квантовой механике на 100 слов",
  );
  console.log("Ответ 3:", result3.response.text().substring(0, 100) + "...");

  console.log("\n✅ Три вызова отправлены. Проверяй Grafana и Jaeger.");
}

main().catch(console.error);
```

### Установи SDK и запусти:

```bash
npm install @google/generative-ai
GEMINI_API_KEY=твой_ключ npx tsx test-auto.ts
```

### Проверь:

**Grafana (http://localhost:3100):**

- [ ] Overview дашборд: видишь 3 запроса
- [ ] Cost Breakdown: видишь стоимость по модели `gemini-2.0-flash-lite`
- [ ] Latency Analysis: видишь 3 точки latency
- [ ] Model Comparison: модель появилась в списке

**Jaeger (http://localhost:16686):**

- [ ] Service: `test-auto-instrumentation`
- [ ] 3 traces со span name `chat gemini-2.0-flash-lite`
- [ ] Каждый trace содержит: `gen_ai.provider.name`, `gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.toad_eye.cost`
- [ ] Промпт и ответ записаны в span attributes (если recordContent не отключен)

---

## Кейс 2: Manual instrumentation (traceLLMCall)

**Что проверяем:** ручное оборачивание для кастомных провайдеров.

### Создай файл `test-manual.ts`:

```typescript
import { initObservability, traceLLMCall } from "toad-eye";

initObservability({
  serviceName: "test-manual-trace",
  endpoint: "http://localhost:4318",
});

async function main() {
  console.log("🐸 Тест 2: Manual instrumentation\n");

  // Симулируем LLM-вызов без реального API
  const result = await traceLLMCall(
    {
      provider: "custom-provider",
      model: "my-fine-tuned-v2",
      prompt: "Тестовый промпт для ручного трейса",
    },
    async () => {
      // Имитация задержки LLM
      await new Promise((resolve) => setTimeout(resolve, 300));
      return {
        completion: "Это ответ от кастомного провайдера",
        inputTokens: 15,
        outputTokens: 25,
        // cost не указываем — автоматически рассчитается (0 для неизвестной модели)
      };
    },
  );

  console.log("Результат:", result);
  console.log("\n✅ Ручной trace отправлен. Ищи custom-provider в Jaeger.");
}

main().catch(console.error);
```

### Запусти:

```bash
npx tsx test-manual.ts
```

### Проверь:

**Jaeger:**

- [ ] Service: `test-manual-trace`
- [ ] Span name: `chat my-fine-tuned-v2`
- [ ] Trace содержит: `gen_ai.provider.name = custom-provider`
- [ ] Trace содержит: `gen_ai.request.model = my-fine-tuned-v2`
- [ ] Промпт и completion записаны в span

**Grafana:**

- [ ] Фильтр по provider: `custom-provider` появился в dropdown

---

## Кейс 3: Privacy Controls

**Что проверяем:** что содержимое промптов НЕ записывается когда включены privacy-настройки.

### Создай файл `test-privacy.ts`:

```typescript
import { initObservability, traceLLMCall, shutdown } from "toad-eye";

// --- Режим 1: recordContent: false ---
initObservability({
  serviceName: "test-privacy-no-content",
  endpoint: "http://localhost:4318",
  recordContent: false,
});

async function testNoContent() {
  console.log("🐸 Тест 3a: recordContent: false\n");

  await traceLLMCall(
    {
      provider: "openai",
      model: "gpt-4o",
      prompt: "ЭТОТ ТЕКСТ НЕ ДОЛЖЕН ПОЯВИТЬСЯ В JAEGER",
    },
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return {
        completion: "СЕКРЕТНЫЙ ОТВЕТ",
        inputTokens: 10,
        outputTokens: 5,
      };
    },
  );

  console.log("✅ Промпт отправлен с recordContent: false");
  console.log(
    "   → Открой Jaeger, найди trace, убедись что текста промпта НЕТ",
  );
}

testNoContent().catch(console.error);
```

### Создай файл `test-privacy-hash.ts`:

```typescript
import { initObservability, traceLLMCall } from "toad-eye";

// --- Режим 2: hashContent: true ---
initObservability({
  serviceName: "test-privacy-hash",
  endpoint: "http://localhost:4318",
  hashContent: true,
  salt: "test-salt-123",
});

async function testHash() {
  console.log("🐸 Тест 3b: hashContent: true\n");

  await traceLLMCall(
    {
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      prompt: "Этот текст должен быть хэширован",
    },
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return {
        completion: "Хэшированный ответ",
        inputTokens: 8,
        outputTokens: 4,
      };
    },
  );

  console.log("✅ Промпт отправлен с hashContent: true");
  console.log("   → В Jaeger вместо текста должен быть sha256:... хэш");
}

testHash().catch(console.error);
```

### Создай файл `test-privacy-redact.ts`:

```typescript
import { initObservability, traceLLMCall } from "toad-eye";

// --- Режим 3: redactDefaults + custom patterns ---
initObservability({
  serviceName: "test-privacy-redact",
  endpoint: "http://localhost:4318",
  redactDefaults: true, // email, SSN, credit card, phone
  redactPatterns: [/секрет\S*/gi], // кастомный паттерн
});

async function testRedact() {
  console.log("🐸 Тест 3c: redactDefaults + redactPatterns\n");

  await traceLLMCall(
    {
      provider: "openai",
      model: "gpt-4o-mini",
      prompt:
        "Пользователь john@secret.com с SSN 123-45-6789 знает секретКод42",
    },
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return {
        completion: "Отправьте результат на admin@company.com",
        inputTokens: 20,
        outputTokens: 10,
      };
    },
  );

  console.log("✅ Промпт с PII отправлен");
  console.log(
    "   → В Jaeger: email, SSN и 'секретКод42' заменены на [REDACTED]",
  );
}

testRedact().catch(console.error);
```

### Запусти каждый:

```bash
npx tsx test-privacy.ts
npx tsx test-privacy-hash.ts
npx tsx test-privacy-redact.ts
```

### Проверь в Jaeger:

- [ ] `test-privacy-no-content`: span НЕ содержит текста промпта и ответа
- [ ] `test-privacy-hash`: вместо текста — `sha256:` + hex строка
- [ ] `test-privacy-redact`: email заменён на `[REDACTED]`, SSN заменён на `[REDACTED]`, `секретКод42` заменён на `[REDACTED]`, остальной текст на месте

---

## Кейс 4: Session Tracking

**Что проверяем:** группировка traces по session ID.

### Создай файл `test-sessions.ts`:

```typescript
import { initObservability, traceLLMCall } from "toad-eye";

initObservability({
  serviceName: "test-sessions",
  endpoint: "http://localhost:4318",
  sessionId: "user-123-conversation-abc",
});

async function main() {
  console.log("🐸 Тест 4: Session Tracking\n");

  // Имитируем 3 "поворота" разговора в одной сессии
  for (let turn = 1; turn <= 3; turn++) {
    await traceLLMCall(
      {
        provider: "openai",
        model: "gpt-4o",
        prompt: `Это сообщение номер ${turn} в нашем разговоре`,
      },
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 150));
        return {
          completion: `Ответ на сообщение ${turn}`,
          inputTokens: 10 * turn, // растёт с каждым turn (контекст!)
          outputTokens: 5 * turn,
        };
      },
    );
    console.log(`  Turn ${turn} отправлен`);
  }

  console.log("\n✅ 3 turns одной сессии отправлены");
  console.log('   → В Jaeger ищи session.id = "user-123-conversation-abc"');
  console.log("   → В Grafana: токены должны расти с каждым turn");
}

main().catch(console.error);
```

### Запусти:

```bash
npx tsx test-sessions.ts
```

### Проверь:

**Jaeger:**

- [ ] Все 3 traces содержат `session.id = user-123-conversation-abc`
- [ ] Можно фильтровать по тегу `session.id`

**Grafana:**

- [ ] Токены растут: turn 1 = 10+5, turn 2 = 20+10, turn 3 = 30+15

---

## Кейс 5: Cost Tracking + Custom Pricing

**Что проверяем:** автоматический расчёт стоимости и кастомные цены.

### Создай файл `test-cost.ts`:

```typescript
import { initObservability, traceLLMCall, setCustomPricing } from "toad-eye";

initObservability({
  serviceName: "test-cost-tracking",
  endpoint: "http://localhost:4318",
});

// Добавляем кастомную модель
setCustomPricing({
  "my-fine-tuned-llama": { inputPer1M: 2.0, outputPer1M: 8.0 },
});

async function main() {
  console.log("🐸 Тест 5: Cost Tracking\n");

  // Вызов 1: стандартная модель (GPT-4o) — цена из встроенной таблицы
  await traceLLMCall(
    { provider: "openai", model: "gpt-4o", prompt: "Hello" },
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      return {
        completion: "Hi",
        inputTokens: 500,
        outputTokens: 200,
        // cost автоматически рассчитается из встроенной таблицы
      };
    },
  );
  console.log("  GPT-4o: 500 in + 200 out tokens");

  // Вызов 2: другая стандартная модель (Claude Sonnet)
  await traceLLMCall(
    {
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      prompt: "Hello",
    },
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      return { completion: "Hi", inputTokens: 500, outputTokens: 200 };
    },
  );
  console.log("  Claude Sonnet: 500 in + 200 out tokens");

  // Вызов 3: кастомная модель — цена из setCustomPricing
  await traceLLMCall(
    { provider: "custom", model: "my-fine-tuned-llama", prompt: "Hello" },
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { completion: "Hi", inputTokens: 500, outputTokens: 200 };
    },
  );
  console.log("  Custom Llama: 500 in + 200 out tokens");

  console.log("\n✅ 3 вызова с разными моделями отправлены");
  console.log("   → Grafana Cost Breakdown: сравни стоимость 3 моделей");
  console.log("   → Jaeger: каждый trace содержит gen_ai.toad_eye.cost");
}

main().catch(console.error);
```

### Запусти:

```bash
npx tsx test-cost.ts
```

### Проверь:

**Grafana → Cost Breakdown:**

- [ ] 3 модели видны
- [ ] GPT-4o дороже Claude Sonnet
- [ ] Кастомная модель использует цену из `setCustomPricing`

**Jaeger:**

- [ ] Каждый trace содержит `gen_ai.toad_eye.cost` с конкретным числом в USD
- [ ] Span name: `chat gpt-4o`, `chat claude-sonnet-4-20250514`, `chat my-fine-tuned-llama`

---

## Кейс 6: Budget Guards

**Что проверяем:** бюджетные лимиты — warn, block, downgrade.

### Создай файл `test-budget.ts`:

```typescript
import {
  initObservability,
  traceLLMCall,
  ToadBudgetExceededError,
} from "toad-eye";

initObservability({
  serviceName: "test-budget-guards",
  endpoint: "http://localhost:4318",
  budgets: {
    daily: 0.001, // $0.001 — сработает почти сразу
  },
  onBudgetExceeded: "block", // блокирует вызовы при превышении
});

async function main() {
  console.log("🐸 Тест 6: Budget Guards\n");

  // Вызов 1 — должен пройти
  await traceLLMCall(
    { provider: "openai", model: "gpt-4o", prompt: "First call" },
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { completion: "OK", inputTokens: 500, outputTokens: 200 };
    },
  );
  console.log("  Вызов 1: ✅ прошёл");

  // Вызов 2 — должен быть заблокирован (бюджет исчерпан)
  try {
    await traceLLMCall(
      { provider: "openai", model: "gpt-4o", prompt: "Second call" },
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return { completion: "OK", inputTokens: 500, outputTokens: 200 };
      },
    );
    console.log("  Вызов 2: ❌ прошёл (не должен был!)");
  } catch (e) {
    if (e instanceof ToadBudgetExceededError) {
      console.log(`  Вызов 2: 🛡️ заблокирован — ${e.message}`);
    } else {
      throw e;
    }
  }

  console.log("\n✅ Budget guard проверен");
  console.log("   → Grafana: метрика gen_ai.toad_eye.budget.blocked");
}

main().catch(console.error);
```

### Запусти:

```bash
npx tsx test-budget.ts
```

### Проверь:

- [ ] Первый вызов прошёл
- [ ] Второй вызов бросил `ToadBudgetExceededError`
- [ ] В Grafana: метрика `gen_ai.toad_eye.budget.blocked` > 0

---

## Кейс 7: Agent Observability (OTel GenAI semconv)

**Что проверяем:** трейсинг шагов агента с OTel-совместимыми span names.

### Создай файл `test-agent.ts`:

```typescript
import { initObservability, traceAgentQuery } from "toad-eye";

initObservability({
  serviceName: "test-agent-tracing",
  endpoint: "http://localhost:4318",
});

async function main() {
  console.log("🐸 Тест 7: Agent Observability (OTel semconv)\n");

  const result = await traceAgentQuery(
    {
      query: "Есть ли опасные астероиды рядом с Землёй?",
      agentName: "space-monitor", // → gen_ai.agent.name
      agentId: "agent-001", // → gen_ai.agent.id
    },
    async (step) => {
      // Шаг 1: Агент думает
      step({
        type: "think",
        stepNumber: 1,
        content: "Мне нужно проверить данные об астероидах",
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Шаг 2: Агент вызывает tool (с toolType)
      step({
        type: "act",
        stepNumber: 2,
        toolName: "near-earth-asteroids",
        toolType: "function", // → gen_ai.tool.type
        content: "Вызываю NASA NeoWs API",
      });

      await new Promise((resolve) => setTimeout(resolve, 200));

      // Шаг 3: Агент получает данные
      step({
        type: "observe",
        stepNumber: 3,
        content: "5 астероидов найдено, ни один не опасен",
      });

      // Шаг 4: Ещё один tool call
      step({
        type: "act",
        stepNumber: 4,
        toolName: "space-weather",
        toolType: "function",
      });

      await new Promise((resolve) => setTimeout(resolve, 150));

      // Шаг 5: Наблюдение
      step({
        type: "observe",
        stepNumber: 5,
        content: "Солнечная активность нормальная",
      });

      // Шаг 6: Финальный ответ
      step({
        type: "answer",
        stepNumber: 6,
        content: "5 астероидов пролетают безопасно, Солнце спокойно",
      });

      return {
        answer: "5 астероидов пролетают безопасно, Солнце спокойно",
      };
    },
  );

  console.log("Ответ агента:", result.answer);
  console.log("\n✅ Agent trace с 6 шагами отправлен");
  console.log("   → Jaeger: ищи span 'invoke_agent space-monitor'");
  console.log("   → Jaeger: tool spans 'execute_tool near-earth-asteroids'");
}

main().catch(console.error);
```

### Запусти:

```bash
npx tsx test-agent.ts
```

### Проверь:

**Jaeger:**

- [ ] Parent span: `invoke_agent space-monitor`
- [ ] `gen_ai.agent.name = space-monitor`
- [ ] `gen_ai.agent.id = agent-001`
- [ ] Tool steps: `execute_tool near-earth-asteroids`, `execute_tool space-weather`
- [ ] `gen_ai.tool.name` на tool spans
- [ ] `gen_ai.tool.type = function` на tool spans
- [ ] `gen_ai.toad_eye.agent.step.type` на каждом child span (think, act, observe, answer)
- [ ] `gen_ai.toad_eye.agent.loop_count` на parent span

**Grafana:**

- [ ] Метрика `gen_ai.agent.steps_per_query` — показывает 6
- [ ] Метрика `gen_ai.agent.tool_usage` — 2 tool calls

---

## Кейс 8: Shadow Guardrails

**Что проверяем:** запись результатов валидации без блокировки.

### Создай файл `test-guard.ts`:

```typescript
import { initObservability, traceLLMCall, recordGuardResult } from "toad-eye";

initObservability({
  serviceName: "test-shadow-guardrails",
  endpoint: "http://localhost:4318",
});

async function main() {
  console.log("🐸 Тест 8: Shadow Guardrails\n");

  // Вызов 1: Ответ прошёл бы валидацию
  await traceLLMCall(
    { provider: "openai", model: "gpt-4o", prompt: "Расскажи про погоду" },
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));

      recordGuardResult({
        mode: "shadow",
        passed: true,
        ruleName: "content_safety",
      });

      return { completion: "Сегодня солнечно", inputTokens: 10, outputTokens: 5 };
    },
  );
  console.log("  Вызов 1: guard PASSED ✅");

  // Вызов 2: Ответ НЕ прошёл бы валидацию (shadow mode — не блокируем)
  await traceLLMCall(
    {
      provider: "openai",
      model: "gpt-4o",
      prompt: "Данные пользователя",
    },
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));

      recordGuardResult({
        mode: "shadow",
        passed: false,
        ruleName: "pii_filter",
        failureReason: "SSN detected in response",
      });

      return {
        completion: "SSN: 123-45-6789",
        inputTokens: 8,
        outputTokens: 12,
      };
    },
  );
  console.log(
    "  Вызов 2: guard WOULD BLOCK 🛡️ (shadow mode — не заблокировал)",
  );

  console.log("\n✅ 2 вызова с shadow guardrails отправлены");
  console.log("   → Grafana: guard.evaluations = 2, guard.would_block = 1");
  console.log("   → Jaeger: gen_ai.toad_eye.guard.* attributes");
}

main().catch(console.error);
```

### Запусти:

```bash
npx tsx test-guard.ts
```

### Проверь:

**Grafana:**

- [ ] `gen_ai.toad_eye.guard.evaluations` = 2
- [ ] `gen_ai.toad_eye.guard.would_block` = 1
- [ ] Видно разбивку по rule_name: content_safety и pii_filter

**Jaeger:**

- [ ] Span attributes: `gen_ai.toad_eye.guard.mode = shadow`
- [ ] Span attributes: `gen_ai.toad_eye.guard.passed = false` (на втором вызове)
- [ ] Span attributes: `gen_ai.toad_eye.guard.failure_reason = SSN detected in response`

---

## Кейс 9: Semantic Drift Monitoring

**Что проверяем:** обнаружение изменений в качестве ответов через embeddings.

> Требуется OpenAI API key для embedding вызовов.

### Создай baseline файл `test-baseline.json`:

```json
{
  "model": "gpt-4o",
  "provider": "openai",
  "embeddingModel": "text-embedding-3-small",
  "embeddings": [],
  "sampleCount": 0,
  "createdAt": "2026-03-21T00:00:00.000Z"
}
```

> Для полного теста нужно предварительно сгенерировать embeddings для baseline-ответов через OpenAI API. Если нет ключа — пропусти этот кейс.

### Создай файл `test-drift.ts`:

```typescript
import { initObservability, createDriftMonitor } from "toad-eye";

initObservability({
  serviceName: "test-drift-monitoring",
  endpoint: "http://localhost:4318",
});

async function main() {
  console.log("🐸 Тест 9: Semantic Drift Monitoring\n");

  const monitor = createDriftMonitor({
    embedding: {
      provider: "openai",
      apiKey: process.env.OPENAI_API_KEY!,
    },
    baselinePath: "./test-baseline.json",
    sampleRate: 1, // проверяем каждый ответ (для теста)
  });

  // Если baseline пустой, monitor вернёт undefined
  const drift = await monitor.check(
    "Меркурий — ближайшая планета к Солнцу",
    "openai",
    "gpt-4o",
  );

  if (drift !== undefined) {
    console.log(`  Drift: ${drift.toFixed(4)}`);
    console.log(
      `  ${drift < 0.3 ? "✅ Низкий drift — ОК" : "⚠️ Высокий drift!"}`,
    );
  } else {
    console.log(
      "  ⚠️ Baseline пустой или не найден — drift не рассчитан",
    );
  }

  console.log("\n✅ Drift monitoring проверен");
  console.log("   → Grafana: метрика gen_ai.toad_eye.semantic_drift");
}

main().catch(console.error);
```

### Запусти:

```bash
OPENAI_API_KEY=твой_ключ npx tsx test-drift.ts
```

### Проверь:

- [ ] Monitor не крашится, даже если baseline пустой
- [ ] Если baseline заполнен: drift value между 0 и 1
- [ ] Grafana: метрика `gen_ai.toad_eye.semantic_drift` показывает значение

---

## Кейс 10: Trace Export (Jaeger → YAML)

**Что проверяем:** экспорт production trace в формат toad-eval.

### Сначала найди trace ID:

1. Открой Jaeger: http://localhost:16686
2. Найди любой trace из предыдущих кейсов
3. Скопируй его ID (длинная hex строка)

### Запусти экспорт:

```bash
npx toad-eye export-trace ВСТАВЬ_TRACE_ID --output ./exported-evals/
```

### Проверь:

- [ ] Создалась папка `exported-evals/`
- [ ] Внутри YAML-файл
- [ ] YAML содержит:
  - [ ] `name:` с ID trace
  - [ ] `cases:` с промптом из trace
  - [ ] `assertions:` автогенерированные (max_length, not_contains, и т.д.)

---

## Кейс 11: Alerting

**Что проверяем:** алерты срабатывают при превышении порогов.

### Создай файл `alerts.yaml`:

```yaml
prometheusUrl: http://localhost:9090
grafanaUrl: http://localhost:3100
evalIntervalSeconds: 15
cooldownMinutes: 1
alerts:
  - name: test_cost_alert
    metric: gen_ai.client.request.cost
    condition: sum_1h > 0.0001
    channels: []
    cooldown: 1
```

### Создай файл `test-alerts.ts`:

```typescript
import { initObservability, traceLLMCall } from "toad-eye";
import { startAlertsFromFile } from "toad-eye/alerts";

initObservability({
  serviceName: "test-alerting",
  endpoint: "http://localhost:4318",
});

async function main() {
  console.log("🐸 Тест 11: Alerting\n");

  // Отправляем данные чтобы метрики появились в Prometheus
  await traceLLMCall(
    { provider: "openai", model: "gpt-4o", prompt: "Test" },
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { completion: "OK", inputTokens: 100, outputTokens: 50 };
    },
  );
  console.log("  Вызов отправлен → ожидаем cost alert");

  // Запускаем alert manager
  const manager = startAlertsFromFile("./alerts.yaml");
  console.log("  AlertManager запущен, ждём 20 секунд...");

  // Ждём оценки
  await new Promise((resolve) => setTimeout(resolve, 20000));
  manager.stop();
  console.log("\n✅ Проверь консоль — должно быть alert-сообщение");
}

main().catch(console.error);
```

### Запусти:

```bash
npx tsx test-alerts.ts
```

### Проверь:

- [ ] В консоли появилось alert-сообщение с именем `test_cost_alert`
- [ ] Значение и порог указаны в сообщении

---

## Кейс 12: CLI UX

**Что проверяем:** CLI команды, ошибки, edge cases.

```bash
# init --force обновляет конфиги
npx toad-eye init --force
# → Должно перезаписать infra/toad-eye/

# help — все команды с ровным выравниванием
npx toad-eye help

# unknown command
npx toad-eye foobar
# → "Unknown command: foobar" + help text

# demo — проверяет что Collector доступен
npx toad-eye demo
# → Если стек запущен: mock traffic
# → Если стек не запущен: warning "OTel Collector not reachable"

# status
npx toad-eye status
# → Зелёные/красные индикаторы для каждого сервиса
```

### Проверь:

- [ ] `init --force` перезаписал конфиги
- [ ] `help` показывает ровное выравнивание команд
- [ ] Неизвестная команда выдаёт ошибку + help
- [ ] `demo` предупреждает если стек не запущен
- [ ] `status` корректно показывает состояние сервисов

---

## Кейс 13: MCP Server Middleware

**Что проверяем:** toadEyeMiddleware() инструментирует MCP server — spans, metrics, privacy.

> Требуется `@modelcontextprotocol/sdk` и `zod`.

### Используем готовый demo:

```bash
# Убедись что стек запущен
npx toad-eye up

# Запусти demo MCP server
npx tsx demo/src/mcp-server/index.ts
```

В другом терминале подключись через MCP Inspector:

```bash
npx @modelcontextprotocol/inspector npx tsx demo/src/mcp-server/index.ts
```

В Inspector:
1. Call tool `calculate` с expression `2 + 2 * 3`
2. Call tool `get-weather` с city `Moscow`
3. Call tool `timestamp` (без аргументов)
4. Read resource `server-info`
5. Get prompt `weather-report` с city `Tokyo`

### Проверь:

**Jaeger (http://localhost:16686):**

- [ ] Service: `toad-eye-mcp-demo`
- [ ] Span names: `execute_tool calculate`, `execute_tool get-weather`, `execute_tool timestamp`
- [ ] Span: `retrieval toad-eye-mcp-demo://info` (resource read)
- [ ] Span: `prompt weather-report` (prompt get)
- [ ] Каждый span содержит `gen_ai.operation.name` (execute_tool, retrieval, prompt)
- [ ] Каждый span содержит `mcp.server.name = toad-eye-mcp-demo`
- [ ] Tool arguments записаны (recordInputs: true в demo)
- [ ] Tool results записаны (recordOutputs: true в demo)

**Prometheus (http://localhost:9090):**

- [ ] `gen_ai_mcp_tool_calls_total` — 3 tool calls с labels `gen_ai_tool_name`
- [ ] `gen_ai_mcp_tool_duration` — histogram с latency
- [ ] `gen_ai_mcp_resource_reads_total` — 1 resource read
- [ ] `gen_ai_mcp_session_active` — 1 active session

**Grafana → MCP Server dashboard:**

- [ ] Tool Call Rate — показывает 3 вызова
- [ ] Avg Tool Duration — значение в ms
- [ ] Error Rate — 0%
- [ ] Tool Performance Overview table — 3 строки (calculate, get-weather, timestamp)

### Дополнительно — тест ошибки:

В Inspector вызови `calculate` с expression `abc` (невалидное выражение).

- [ ] Span status: ERROR
- [ ] `error.type` — class name ошибки (не message!)
- [ ] `gen_ai_mcp_tool_errors_total` — 1 error

---

## Кейс 14: Subpath Imports

**Что проверяем:** advanced модули доступны через отдельные entry points.

### Создай файл `test-subpath.ts`:

```typescript
// Все эти импорты должны работать без ошибок
import { initObservability, traceLLMCall } from "toad-eye";
import { AlertManager } from "toad-eye/alerts";
import { createDriftMonitor } from "toad-eye/drift";
import { exportTrace } from "toad-eye/export";
import { ToadEyeAISpanProcessor, withToadEye } from "toad-eye/vercel";
import { toadEyeMiddleware, traceSampling } from "toad-eye/mcp";

console.log("🐸 Тест 14: Subpath Imports\n");
console.log("  initObservability:", typeof initObservability); // function
console.log("  AlertManager:", typeof AlertManager); // function
console.log("  createDriftMonitor:", typeof createDriftMonitor); // function
console.log("  exportTrace:", typeof exportTrace); // function
console.log("  ToadEyeAISpanProcessor:", typeof ToadEyeAISpanProcessor); // function
console.log("  withToadEye:", typeof withToadEye); // function
console.log("  toadEyeMiddleware:", typeof toadEyeMiddleware); // function
console.log("  traceSampling:", typeof traceSampling); // function
console.log("\n✅ Все subpath imports работают");
```

### Запусти:

```bash
npx tsx test-subpath.ts
```

### Проверь:

- [ ] Никаких import errors
- [ ] Все exports — `function`

---

## Кейс 15: Все 9 дашбордов Grafana

**Что проверяем:** каждый дашборд работает с реальными данными.

После прогона кейсов 1-13, открой Grafana (http://localhost:3100) и пройди:

### Overview Dashboard:

- [ ] Total requests: сумма всех запросов
- [ ] Error rate: ≥ 0
- [ ] Avg latency: показывает значение
- [ ] Total cost: > $0
- [ ] Фильтр `$provider`: видны все провайдеры из тестов
- [ ] Фильтр `$model`: видны все модели

### Cost Breakdown Dashboard:

- [ ] Spend по provider
- [ ] Spend по model
- [ ] GPT-4o дороже остальных

### Latency Analysis Dashboard:

- [ ] p50, p95, p99 — показывают значения
- [ ] Фильтрация по модели работает

### Error Drill-down Dashboard:

- [ ] Видна ошибка из кейса 6 (budget block)
- [ ] Разбивка по provider/model

### Model Comparison Dashboard:

- [ ] Несколько моделей на одном графике
- [ ] Можно сравнить latency vs cost

### FinOps Attribution Dashboard:

- [ ] Если передавали attributes (team, userId) — видны в разбивке

### Provider Health Dashboard:

- [ ] Статусы провайдеров (healthy/degraded)

### Agent Workflow Dashboard:

- [ ] Steps per query из кейса 7
- [ ] Tool usage frequency
- [ ] Step type breakdown (think, act, observe, answer)

### MCP Server Dashboard:

- [ ] Tool Call Rate — показывает данные из кейса 13
- [ ] Avg Tool Duration — значение в ms
- [ ] Tool Duration p50/p95 — по каждому tool
- [ ] Errors by Tool — если тестили невалидные вызовы
- [ ] Resource Reads by URI — `toad-eye-mcp-demo://info`
- [ ] Tool Performance Overview table — все tools

---

## Кейс 16: Full Lifecycle — всё вместе

**Что проверяем:** весь стек работает как единое целое.

### Создай файл `test-full-lifecycle.ts`:

```typescript
import {
  initObservability,
  traceLLMCall,
  traceAgentQuery,
  recordGuardResult,
  setCustomPricing,
} from "toad-eye";

initObservability({
  serviceName: "test-full-lifecycle",
  endpoint: "http://localhost:4318",
  sessionId: "lifecycle-session-001",
  redactDefaults: true,
});

setCustomPricing({
  "internal-model-v3": { inputPer1M: 1, outputPer1M: 3 },
});

async function main() {
  console.log("🐸 Тест 16: Full Lifecycle\n");

  // 1. Обычный LLM вызов с cost tracking + guard
  await traceLLMCall(
    { provider: "openai", model: "gpt-4o", prompt: "Summarize this doc" },
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));

      recordGuardResult({
        mode: "shadow",
        passed: true,
        ruleName: "length_check",
      });

      return {
        completion: "Document summary here",
        inputTokens: 800,
        outputTokens: 200,
      };
    },
  );
  console.log("  ✅ LLM call + guard check");

  // 2. Agent query с OTel semconv
  await traceAgentQuery(
    {
      query: "Analyze the document",
      agentName: "doc-analyzer",
      agentId: "analyzer-001",
    },
    async (step) => {
      step({
        type: "think",
        stepNumber: 1,
        content: "Need to read the document",
      });
      step({
        type: "act",
        stepNumber: 2,
        toolName: "document-reader",
        toolType: "function",
      });
      step({
        type: "observe",
        stepNumber: 3,
        content: "Found 5 key points",
      });

      recordGuardResult({
        mode: "shadow",
        passed: false,
        ruleName: "completeness_check",
        failureReason: "Only 5 of 8 expected points",
      });

      step({
        type: "answer",
        stepNumber: 4,
        content: "5 key points extracted",
      });
      return { answer: "5 key points extracted" };
    },
  );
  console.log("  ✅ Agent query + guard check");

  // 3. Кастомная модель
  await traceLLMCall(
    {
      provider: "internal",
      model: "internal-model-v3",
      prompt: "Classify intent for user john@example.com",
    },
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return {
        completion: "intent: purchase",
        inputTokens: 50,
        outputTokens: 10,
      };
    },
  );
  console.log("  ✅ Custom model call (email should be redacted)");

  console.log("\n🎉 Full lifecycle пройден!");
  console.log("   → Jaeger: 3 traces under session lifecycle-session-001");
  console.log("   → Jaeger: agent span 'invoke_agent doc-analyzer'");
  console.log("   → Guard: 1 passed, 1 would_block");
  console.log("   → Cost: 3 модели с разными ценами");
  console.log("   → Privacy: email [REDACTED] в третьем trace");
}

main().catch(console.error);
```

### Запусти:

```bash
npx tsx test-full-lifecycle.ts
```

### Проверь всё вместе:

- [ ] Все 3 traces в Jaeger под session `lifecycle-session-001`
- [ ] Agent trace: `invoke_agent doc-analyzer` с `execute_tool document-reader`
- [ ] Guard метрики: 2 evaluations, 1 would_block
- [ ] Cost по 3 разным моделям в Grafana
- [ ] Email `john@example.com` заменён на `[REDACTED]` (redactDefaults)
- [ ] Всё под одним service name `test-full-lifecycle`

---

## Финальный чеклист

| Кейс | Что проверяли                        | Статус |
| ---- | ------------------------------------ | ------ |
| 1    | Auto-instrumentation (реальный SDK)  | ⬜     |
| 2    | Manual traceLLMCall                  | ⬜     |
| 3a   | Privacy: recordContent: false        | ⬜     |
| 3b   | Privacy: hashContent + salt          | ⬜     |
| 3c   | Privacy: redactDefaults + patterns   | ⬜     |
| 4    | Session tracking                     | ⬜     |
| 5    | Cost tracking + custom pricing       | ⬜     |
| 6    | Budget guards (block mode)           | ⬜     |
| 7    | Agent tracing (OTel semconv)         | ⬜     |
| 8    | Shadow guardrails                    | ⬜     |
| 9    | Semantic drift monitoring            | ⬜     |
| 10   | Trace export (Jaeger → YAML)         | ⬜     |
| 11   | Alerting (startAlertsFromFile)       | ⬜     |
| 12   | CLI UX (init --force, help, errors)  | ⬜     |
| 13   | MCP Server middleware                | ⬜     |
| 14   | Subpath imports                      | ⬜     |
| 15   | Все 9 Grafana дашбордов              | ⬜     |
| 16   | Full lifecycle (всё вместе)          | ⬜     |

---

## Cleanup

```bash
npx toad-eye down       # остановить стек
cd ..
rm -rf toad-eye-test    # удалить тестовую директорию
```

---

_🐸👁️ "Если жаба видит — значит работает"_
