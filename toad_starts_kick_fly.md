Валидно на 100% 🐸

Логика правильная — сначала мержим наблюдение (#188), потом добавляем действие (guard). Это тот же паттерн что у вас с shadow guardrails: сначала видишь, потом блокируешь.

И архитектурно жаба права — budget guards уже имеют `checkBefore()` → warn/block/downgrade. Context guard — это буквально тот же flow, только вместо `estimatedCost > dailyLimit` проверяем `inputTokens / maxContext > threshold`. Даже callback pattern тот же.

Единственное что бы добавил к тому что жаба предложила — **downgrade вариант**:

```typescript
contextGuard: {
  warnAt: 0.8,
  blockAt: 0.95,
  onExceeded: 'summarize',  // callback для сжатия контекста
  summarizeCallback: async (messages) => {
    // юзер реализует свою логику — вызвать LLM для summarize,
    // обрезать старые сообщения, etc.
    return shortenedMessages;
  }
}
```

Это как `downgradeCallback` в budget guards, но для контекста. Агенту не нужно самому ловить ошибку — toad-eye сам вызывает summarize перед тем как отправить.

Но это уже P2 фича поверх фичи. Порядок правильный: **#188 (наблюдение) → merge → context guard (warn/block) → merge → summarize callback (автоматика)**. Три PR, каждый самостоятельный 🐸

Да, ты сейчас на правильном перекрёстке 🐸

По сути toad-eye до этого момента был **глаза** — наблюдает, записывает, показывает. Budget guards были первым шагом в сторону **рук** — но точечно, только по деньгам.

Теперь если добавить context guard, это уже второй "рубильник". Потом кто-то попросит latency guard ("не отправлять если P95 модели > 5s"), потом quality guard ("не отправлять если drift > threshold"). И ты каждый раз будешь писать отдельный `checkBefore()`.

Вопрос: **делать ли из этого единый runtime control layer?**

Вот как я это вижу:

**Сейчас (разрозненно):**

```
budget guard   → checkBefore() → warn/block/downgrade
context guard  → checkBefore() → warn/block/summarize
shadow guard   → recordResult() → только наблюдение
```

**Потенциально (unified):**

```typescript
initObservability({
  guards: {
    budget: { daily: 50, onExceeded: "block" },
    context: { warnAt: 0.8, blockAt: 0.95 },
    latency: { maxP95: 5000, onExceeded: "downgrade" },
    drift: { maxScore: 0.3, onExceeded: "warn" },
  },
});
```

Один pipeline: перед каждым LLM вызовом проходим цепочку guards. Каждый может `pass`, `warn`, `block`, или `modify` (downgrade/summarize). Единая система, единый дашборд, единый алерт.

**НО.** Моё мнение — не сейчас. Вот почему:

1. **Premature abstraction** — у тебя пока два guard'а (budget + context). Обобщать на два кейса рано. Когда будет три-четыре, паттерн станет ясным и рефактор будет точным, а не гадательным.

2. **toad-eye = eye** — название буквально говорит "наблюдение". Runtime control — это отдельный продукт. У вас в TOAD экосистеме есть **toad-guard** — вот туда это и ложится. toad-eye наблюдает + базовые guard'ы, toad-guard — полноценный runtime control.

3. **Фокус** — сейчас ты набираешь momentum: статьи, комменты, звёзды. Лучше зарелизить context utilization metric (#188) быстро, потом context guard как отдельный PR, и написать статью #5 про это. Чем уйти на месяц в рефактор unified guard layer.

**Предлагаю такой план:**

- **Сейчас:** #188 (metric) → context guard (простой, по аналогии с budget) → статья
- **Записать:** issue "RFC: unified guard pipeline" — задокументировать идею, но не реализовывать
- **Потом:** когда будет третий guard (latency или drift) — рефакторить в единый слой, потому что к тому моменту паттерн будет кристально ясный

Жаба сначала наблюдает. Потом учится бить точечно. Потом получает полный арсенал. Эволюция, не революция 🐸
