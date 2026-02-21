## Техническое задание: Perplexity Spaces Backup

### Цель

Расширение Firefox, позволяющее:
1. **Экспортировать** все Spaces пользователя (название, эмодзи, системный промпт, описание) в один `.md`-файл
2. **Импортировать** этот файл обратно — создавая Spaces с оригинальным именем, эмодзи и промптом

***

## Стек

| Компонент | Выбор | Обоснование |
|---|---|---|
| Язык | **TypeScript 5.x** | строгая типизация для API-объектов |
| Сборщик | **WXT** (Web Extension Toolkit) | нативная поддержка MV3/Firefox, hot reload, типизированные `browser.*` API |
| UI popup | **Preact + htm** (без JSX-компилятора) | ~3 KB gzip, нет overkill React |
| Стили | **Plain CSS** (без фреймворка) | минимальный бандл, ≤ 5 KB |
| Линтер | **ESLint + prettier** | |
| Тесты | **Vitest** | unit-тесты для парсера MD и API-клиента |
| Manifest | **V3** (Firefox 109+) | актуальный стандарт |

***

## Архитектура расширения

```
src/
├── manifest.json
├── entrypoints/
│   ├── background.ts        # Service Worker (MV3)
│   ├── popup/
│   │   ├── index.html
│   │   └── App.ts           # UI: кнопки Export / Import, прогресс
│   └── content/
│       └── index.ts         # Content Script → вызывает internal API
├── utils/
│   ├── api.ts               # Клиент Perplexity internal API
│   ├── markdown.ts          # Сериализатор/парсер MD
│   └── types.ts             # Типы Space, BackupFile
└── wxt.config.ts
```

***

## Взаимодействие с API браузера

### Разрешения в `manifest.json`

```json
{
  "manifest_version": 3,
  "name": "Perplexity Spaces Backup",
  "version": "1.0.0",
  "permissions": [
    "downloads",
    "scripting",
    "storage"
  ],
  "host_permissions": [
    "*://www.perplexity.ai/*"
  ],
  "action": { "default_popup": "popup/index.html" },
  "background": { "service_worker": "background.js" },
  "content_scripts": [{
    "matches": ["*://www.perplexity.ai/*"],
    "js": ["content/index.js"],
    "run_at": "document_idle"
  }]
}
```

**Почему именно эти разрешения:**
- `scripting` — для `browser.scripting.executeScript()` (инъекция функций в таб)
- `downloads` — для `browser.downloads.download()` при сохранении `.md`
- `host_permissions: perplexity.ai` — Content Script может делать `fetch()` к internal API с автоматически подставляемыми session cookies (same-origin)
- `storage` — кешировать обнаруженные эндпоинты

### Поток сообщений

```
Popup (click Export)
  └─► background.ts: sendMessage("EXPORT_SPACES")
        └─► scripting.executeScript → content/index.ts
              └─► fetch("https://www.perplexity.ai/rest/user/spaces")
                    └─► вернуть данные через chrome.runtime.sendMessage
                          └─► background.ts: скачать MD через downloads.download()
                                └─► Popup: показать успех/ошибку
```

***

## Взаимодействие с Perplexity internal API

Perplexity не имеет публичного API для Spaces, но использует внутренние REST-эндпоинты. Content Script работает в контексте `perplexity.ai`, поэтому все `fetch()`-запросы автоматически подписаны `Cookie: __Secure-next-auth.session-token=...` (same-origin policy). [reddit](https://www.reddit.com/r/perplexity_ai/comments/1hfi1qw/can_we_use_perplexity_spaces_via_api/)

### Шаг 1: Обнаружение эндпоинтов (один раз, при установке)

```typescript
// content/index.ts — перехват XHR/fetch через Proxy
const originalFetch = window.fetch;
window.fetch = new Proxy(originalFetch, {
  apply(target, thisArg, args) {
    const url = args[0]?.toString() ?? '';
    if (url.includes('/rest/') && url.includes('space')) {
      browser.runtime.sendMessage({ type: 'ENDPOINT_FOUND', url });
    }
    return Reflect.apply(target, thisArg, args);
  }
});
```

Полученный URL кешируется в `browser.storage.local`. После первого посещения `/spaces` — эндпоинт известен навсегда.

### Шаг 2: Основные API-вызовы (utils/api.ts)

```typescript
// Предполагаемые эндпоинты (верифицировать через DevTools → Network)
const BASE = 'https://www.perplexity.ai';

export async function getSpaces(): Promise<Space[]> {
  // Вероятные кандидаты — проверять в порядке очереди:
  const endpoints = [
    `${BASE}/rest/user/spaces`,
    `${BASE}/rest/spaces`,
    `${BASE}/api/spaces`,
  ];
  for (const url of endpoints) {
    const res = await fetch(url, {
      credentials: 'include',  // ключевой параметр — включает cookies
      headers: { 'Accept': 'application/json' }
    });
    if (res.ok) return (await res.json()).spaces ?? await res.json();
  }
  throw new Error('Spaces API endpoint not found');
}

export async function createSpace(space: SpaceInput): Promise<void> {
  await fetch(`${BASE}/rest/spaces/create`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: space.name,
      emoji: space.emoji,
      instructions: space.systemPrompt,
      description: space.description ?? '',
    })
  });
}
```

**Типизация объекта Space:**

```typescript
interface Space {
  uuid: string
  title: string
  emoji: string | null
  instructions: string    // системный промпт
  description: string | null
  is_default: boolean
  created_at: string
}
```

***

## Формат MD-файла

```markdown
<!--
  Perplexity Spaces Backup
  exported_at: 2026-02-21T08:38:00Z
  spaces_count: 2
  version: 1
-->

---

## 🔬 My Research Assistant

- **emoji:** 🔬
- **description:** Deep scientific search assistant

### System Prompt

```
You are a specialized research assistant focused on
scientific literature. Always cite sources...
```

---

## 💻 Code Helper

- **emoji:** 💻
- **description:** 

### System Prompt

```
You are an expert software engineer. Prefer TypeScript.
Write clean, idiomatic code with tests...
```

---
```

**Правила парсера (utils/markdown.ts):**
- Разделитель между Spaces: `---` (горизонтальная линия)
- Имя Space: заголовок `## {emoji} {name}`
- Эмодзи: строка `- **emoji:** {emoji}` (резервный способ)
- Системный промпт: блок кода ` ``` ` после `### System Prompt`

***

## Алгоритм экспорта (фаза Export)

```
1. Popup: пользователь нажимает "Export Spaces"
2. background.ts → scripting.executeScript(tabId, { func: exportSpaces })
3. content/api.ts → GET /rest/user/spaces (credentials: 'include')
4. Получаем массив Space[]
5. markdown.ts: serialize(spaces[]) → строка MD
6. background.ts: blob = new Blob([md], {type: 'text/markdown'})
7. browser.downloads.download({
     url: URL.createObjectURL(blob),
     filename: `perplexity-spaces-${date}.md`,
     saveAs: true
   })
8. Popup: "Экспортировано N spaces ✓"
```

## Алгоритм импорта (фаза Import)

```
1. Popup: <input type="file" accept=".md"> → пользователь выбирает файл
2. FileReader.readAsText() → строка MD
3. markdown.ts: parse(md) → SpaceInput[]
4. Для каждого SpaceInput:
   a. Показать прогресс "Создаём: {name}..."
   b. content/api.ts → POST /rest/spaces/create
   c. Задержка 500ms между запросами (rate limit)
5. Popup: "Импортировано N/N spaces ✓" или список ошибок
```

***

## Структура Popup UI (App.ts)

```
┌─────────────────────────────────┐
│  🔐 Войдите на perplexity.ai    │  ← если не авторизован
│─────────────────────────────────│
│  📤 Экспорт Spaces              │
│  [Export to .md]                │
│─────────────────────────────────│
│  📥 Импорт Spaces               │
│  [Выбрать .md файл]             │
│  ─────────────────────          │
│  ████████░░ 4/6 создано...      │  ← прогресс-бар при импорте
│─────────────────────────────────│
│  ⚠️ Ошибки: Space "X" уже есть  │
└─────────────────────────────────┘
```

***

## Plan разработки (фазы)

| Фаза | Задачи | Оценка |
|---|---|---|
| **1. Setup** | WXT init, TypeScript, ESLint, структура файлов, базовый manifest | 2–3 ч |
| **2. API Discovery** | DevTools-анализ трафика perplexity.ai/spaces, верификация эндпоинтов, реализация `getSpaces()` и `createSpace()` | 4–6 ч |
| **3. MD Serializer** | `serialize()` и `parse()` с unit-тестами Vitest, граничные случаи (пустой промпт, эмодзи в имени) | 3–4 ч |
| **4. Export flow** | `scripting.executeScript`, `downloads.download`, message passing popup↔background↔content | 3–4 ч |
| **5. Import flow** | FileReader в popup, rate limiting, прогресс-бар, обработка дубликатов | 3–4 ч |
| **6. Edge cases** | Нет авторизации, rate limit 429 (retry с backoff), частичный импорт | 2–3 ч |
| **7. Firefox AMO** | Packaging (`wxt build --browser firefox`), скриншоты, AMO submission | 2 ч |

**Итого: ~20–26 часов** разработки.

***

## Ключевые риски

- **Изменение внутреннего API Perplexity** — не задокументировано, может сломаться в любой момент; нужна обработка ошибок с понятными сообщениями и механизм endpoint-discovery при каждом запуске
- **Аутентификация** — расширение работает **только если пользователь открыт на `perplexity.ai`** в активном табе; сессионные cookies не доступны напрямую через `browser.cookies` без флага `httpOnly`
- **Rate limiting** — при импорте большого числа Spaces нужен `await sleep(500ms)` между запросами
