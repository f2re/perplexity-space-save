# GEMINI.md — Perplexity Spaces Backup (Firefox Extension)

## Project Overview

A Firefox WebExtension (Manifest V3) that exports all Perplexity AI Spaces
(name, emoji, system prompt, description) to a `.md` file and re-imports them
to recreate Spaces via Perplexity's internal (undocumented) REST API.

No public API exists for Spaces. All API calls are made from a Content Script
running in the context of `perplexity.ai` — authentication is implicit via
session cookies (same-origin `fetch` with `credentials: 'include'`).

---

## Tech Stack

| Tool         | Version  | Purpose                                |
|--------------|----------|----------------------------------------|
| WXT          | ^0.19    | Build framework for WebExtensions      |
| TypeScript   | ^5.5     | Primary language, strict mode          |
| Preact       | ^10.23   | Popup UI (no JSX transform — use htm)  |
| htm          | ^3.1     | Tagged template JSX alternative        |
| Vitest       | ^2.x     | Unit tests for pure functions only     |
| ESLint       | ^9.x     | Linting (flat config)                  |
| Prettier     | ^3.x     | Formatting                             |

**Package manager: `pnpm`**

---

## Development Commands

```bash
# Install dependencies
pnpm install

# Start dev mode with hot reload (opens Firefox with extension loaded)
pnpm dev

# Build for Firefox (output: .output/firefox-mv3/)
pnpm build

# Run unit tests (Vitest)
pnpm test

# Run tests in watch mode
pnpm test:watch

# Type-check without emitting
pnpm typecheck

# Lint
pnpm lint

# Lint + fix
pnpm lint:fix

# Package extension for Firefox AMO (.zip)
pnpm pack:firefox

# Check combined GEMINI.md context (if multiple layers loaded)
# /memory show   ← run this inside gemini CLI session
```

**Before committing, always run:**
```bash
pnpm typecheck && pnpm lint && pnpm test
```
All three must pass with zero errors. Do NOT commit if any fail.

---

## Project Structure

```
perplexity-spaces-backup/
├── GEMINI.md                    ← you are here
├── wxt.config.ts                ← WXT configuration (Firefox target)
├── tsconfig.json                ← strict: true, no implicit any
├── package.json
├── vitest.config.ts
├── eslint.config.js             ← flat config format
│
├── src/
│   ├── entrypoints/
│   │   ├── background.ts        ← Service Worker: message routing, downloads
│   │   ├── popup/
│   │   │   ├── index.html
│   │   │   └── App.ts           ← Preact UI (htm tagged templates, no JSX)
│   │   └── content/
│   │       └── index.ts         ← Content Script: fetch interceptor + API calls
│   │
│   └── utils/
│       ├── api.ts               ← Perplexity internal API client
│       ├── markdown.ts          ← MD serializer and parser
│       ├── types.ts             ← Shared TypeScript interfaces
│       └── constants.ts         ← API endpoint candidates, config values
│
├── tests/
│   ├── markdown.test.ts         ← Unit tests for serialize() and parse()
│   └── api.test.ts              ← Unit tests for response normalizer
│
└── .output/                     ← Build artifacts (gitignored)
```

---

## Architecture: Message Passing Protocol

Communication follows a strict unidirectional pattern. Do NOT bypass it.

```
Popup UI
  │
  │  browser.runtime.sendMessage({ type: MsgType, payload? })
  ▼
Background Service Worker (background.ts)
  │
  │  browser.scripting.executeScript({ target: { tabId }, func })
  ▼
Content Script (content/index.ts)
  │
  │  fetch("https://www.perplexity.ai/...", { credentials: 'include' })
  ▼
Perplexity Internal API
  │
  └── Response flows back via return value of executeScript()
```

### Message Types (src/utils/types.ts)

```typescript
type MsgType =
  | 'EXPORT_SPACES'       // Popup → Background
  | 'IMPORT_SPACES'       // Popup → Background (payload: SpaceInput[])
  | 'EXPORT_RESULT'       // Background → Popup (payload: Space[] | Error)
  | 'IMPORT_PROGRESS'     // Background → Popup (payload: { done: number, total: number })
  | 'ENDPOINT_DISCOVERED' // Content → Background (payload: string)
```

### Key Rule: Content Script cannot use `browser.downloads`
Downloads must be triggered in the **Background Service Worker** only.
Pass serialized MD string back to background via `executeScript` return value.

---

## TypeScript Conventions

```jsonc
// tsconfig.json must include:
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true
  }
}
```

- **No `any`** — use `unknown` and narrow with type guards
- **No non-null assertions (`!`)** — use optional chaining and explicit checks
- **Prefer `type` over `interface`** for unions; use `interface` for objects that may be extended
- **Named exports only** — no default exports except entrypoint files required by WXT
- **Error handling**: always return `Result<T, AppError>` type, never `throw` in utility functions

```typescript
// Preferred pattern for fallible operations
type Result<T, E = AppError> =
  | { ok: true; value: T }
  | { ok: false; error: E }
```

---

## Perplexity Internal API Reference

The API is undocumented. Content Script makes same-origin calls — cookies are
sent automatically. **Endpoint discovery runs once on first visit to `/spaces`.**

### Endpoint Candidates (try in order, cache the first that succeeds)

```typescript
// src/utils/constants.ts
export const SPACES_ENDPOINTS = {
  list: [
    'https://www.perplexity.ai/rest/user/spaces',
    'https://www.perplexity.ai/rest/collections',
    'https://www.perplexity.ai/api/spaces',
  ],
  create: [
    'https://www.perplexity.ai/rest/spaces/create',
    'https://www.perplexity.ai/rest/collections/create',
  ],
} as const
```

### Fetch Options (always include these)

```typescript
const DEFAULT_FETCH_OPTIONS: RequestInit = {
  credentials: 'include',   // sends session cookies — CRITICAL
  headers: {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
  },
}
```

### Expected Space Object Shape

```typescript
// src/utils/types.ts
interface PerplexitySpace {
  uuid: string
  title: string
  emoji: string | null           // may be null if not set
  instructions: string           // system prompt
  description: string | null
  is_default: boolean
  created_at: string             // ISO 8601
  updated_at: string
}
```

Response may be wrapped: `{ spaces: PerplexitySpace[] }` or bare array.
The normalizer in `api.ts` must handle both cases.

### Rate Limiting

When creating Spaces during import, **always wait 500ms between requests:**
```typescript
await new Promise(resolve => setTimeout(resolve, 500))
```
On HTTP 429: retry after `Retry-After` header value (or 5000ms fallback).
Maximum 3 retries per Space.

### Endpoint Discovery via Fetch Proxy

On page load, the content script patches `window.fetch` to sniff API calls:
```typescript
// content/index.ts
const _fetch = window.fetch.bind(window)
window.fetch = async (...args) => {
  const url = String(args instanceof Request ? args.url : args)
  if (/\/rest\/(user\/)?spaces|\/rest\/collections/.test(url)) {
    await browser.runtime.sendMessage({ type: 'ENDPOINT_DISCOVERED', payload: url })
  }
  return _fetch(...args)
}
```
Store discovered URL in `browser.storage.local` as `{ spacesListEndpoint: string }`.

---

## Markdown Backup Format Specification

This is the canonical format. Parser and serializer **must** be inverses of each other.
Tests in `tests/markdown.test.ts` enforce round-trip fidelity.

```markdown
<!--
  perplexity-spaces-backup
  version: 1
  exported_at: 2026-02-21T08:38:00Z
  spaces_count: 3
-->

***

## 🔬 My Research Assistant

- **emoji:** 🔬
- **description:** Deep scientific search assistant

### System Prompt

` ` `
You are a specialized research assistant focused on scientific
literature. Always cite peer-reviewed sources. Respond in the
language of the question.
` ` `

***

## 💻 Code Helper

- **emoji:** 💻
- **description:**

### System Prompt

` ` `
You are an expert TypeScript engineer. Prefer functional patterns.
Write clean code with tests.
` ` `

***
```

### Parser Rules

1. Split document on `\n---\n` — each segment is one Space or the header comment
2. Skip segments that start with `<!--`
3. Extract name from `## {emoji} {name}` heading (first `##` line)
4. Extract emoji from `- **emoji:** {value}` line (fallback: first character of name if it's an emoji)
5. Extract description from `- **description:** {value}` (may be empty string)
6. Extract system prompt: content between first ` ``` ` and last ` ``` ` after `### System Prompt`
7. If system prompt block is empty string — treat as `""`, not null

### Serializer Rules

- Emoji in heading is decorative; canonical emoji value comes from `**emoji:**` line
- If `space.emoji` is `null`, use `💬` as default in heading, write `""` in emoji line
- Escape ` ``` ` inside system prompt by replacing with `&#96;&#96;&#96;`
- Filename format: `perplexity-spaces-YYYY-MM-DD.md`

---

## Testing Requirements

Unit tests in `tests/` cover **only pure functions** (no browser APIs, no fetch).
Mock browser APIs are NOT needed — architecture separates IO from logic.

### Mandatory test cases for `markdown.test.ts`

- [ ] Round-trip: `parse(serialize(spaces))` equals original `spaces` array
- [ ] Handles `emoji: null` — uses default `💬`
- [ ] Handles empty `description` string
- [ ] Handles multi-line system prompt with triple backticks inside
- [ ] Handles 0 spaces (empty export)
- [ ] Parses correct `spaces_count` from header comment
- [ ] Handles Space with empty system prompt `""`

### Coverage target: ≥ 90% for `utils/markdown.ts` and `utils/api.ts`

Run coverage report:
```bash
pnpm test --coverage
```

---

## Agent Behavior Rules

### Autonomous actions (no confirmation needed)
- Read any file in the project
- Run `pnpm test`, `pnpm typecheck`, `pnpm lint`
- Run `pnpm build` to check compilation
- Create/edit files in `src/` and `tests/`

### Requires explicit user confirmation before executing
- `pnpm dev` (launches Firefox with extension — opens GUI)
- `pnpm pack:firefox` (produces distributable artifact)
- Any `git commit` or `git push`
- `pnpm install` or adding new dependencies to `package.json`

### Never do
- Add dependencies not in the approved tech stack without asking
- Use `chrome.*` API — always use `browser.*` (WXT provides the polyfill)
- Use `document.cookie` to access session tokens — never touch cookies directly
- Store API responses in `browser.storage.sync` — use `browser.storage.local` only
- Use `eval()` or `new Function()` — CSP will block it in MV3
- Inline scripts in HTML — forbidden by MV3 CSP

---

## Current Development Phase

**Phase 2: API Discovery & Verification**

Completed:
- [x] WXT project scaffold with TypeScript strict config
- [x] `types.ts` — all interfaces defined
- [x] `constants.ts` — endpoint candidates listed
- [x] `markdown.ts` — serializer implemented, parser in progress

In progress:
- [ ] `markdown.ts` — parser + full test coverage
- [ ] `api.ts` — `getSpaces()` implementation with endpoint fallback

Up next:
- [ ] `content/index.ts` — fetch proxy for endpoint discovery
- [ ] `background.ts` — message routing + `browser.downloads` integration
- [ ] `popup/App.ts` — export/import UI with progress bar

**To continue from this state:**
1. Run `pnpm typecheck` to see current errors
2. Open `src/utils/markdown.ts` and complete the `parse()` function
3. Run `pnpm test:watch` to develop against tests

---

## Known Issues & Constraints

- Perplexity may change internal API endpoints at any time — endpoint discovery
  mitigates this but cannot fully prevent breakage
- Extension requires user to have `perplexity.ai` open in an active tab to
  execute Content Script calls; show clear error if no qualifying tab found
- `httpOnly` session cookies are inaccessible via `browser.cookies` API — the
  same-origin Content Script approach is the only viable auth method
- Firefox MV3 service workers terminate after ~30s of inactivity; for large
  imports (>20 Spaces), keep-alive is needed via periodic `browser.alarms`

