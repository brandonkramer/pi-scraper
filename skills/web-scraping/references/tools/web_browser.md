# `web_browser`

Drive a **live page** over multiple steps: navigate, click, fill, select, inspect — plus read, screenshot, evaluate, exportCookies. **Stateful** — the page persists across calls, keyed by `sessionId`.

> **`mode=browser` vs `web_browser`:** `mode=browser` renders and *reads* one URL (a stateless scrape). `web_browser` *operates* a page across steps (stateful session, clickable `@eN` refs). Different tools — read once vs drive.

## Actions

| Action | Needs | Description |
|--------|-------|-------------|
| `navigate` | `url` | Load a URL in the session's page |
| `click` | `selector` | Click an element |
| `fill` | `selector` + `value` | Type into an input |
| `select` | `selector` + `value` | Choose a `<select>` option |
| `inspect` | — | Re-read the page's interactive elements (returns the a11y **snapshot** + `@eN` refs — how to *drive* the page) |
| `read` | — | Read the live page's content (post-interaction DOM). Bare → a cheap **orientation digest** (word/link counts, heading outline with line numbers, landmarks). `linesMatching=[…]` → greps the body to matching snippets. `storeCapture=true` → full body as a `responseId` |
| `screenshot` | — | Save a PNG of the page (or a `selector` element) to disk → `blobPath` + `responseId`. **Binary artifact, not inlined** (see warning below) |
| `evaluate` | `script` | Run JS in the page → JSON-serialized result (30 s default timeout, output capped at 10 000 chars) |
| `exportCookies` | `scopeUrl` | Copy the session's cookies for `scopeUrl` into the HTTP-session cookie jar; returns **counts only, never values** |

`navigate`/`click`/`fill`/`select`/`inspect` return the current `url` plus a fresh **snapshot**. The snapshot comes in three shapes — the *navigate token ladder*, mirroring `read`'s digest→grep→full:

- **outline** — `navigate`'s default. Orientation only: landmarks, interactive role counts, and the top headings. **No `@eN` refs.** Orient here, then drill.
- **interactive** — what `click`/`fill`/`select`/`inspect` return, and what `navigate` returns once you pass `scope`/`roles`/`detail`. The interactive-only a11y tree (links, buttons, inputs, headings) flattened one-per-line, each carrying an `@eN` ref. Link URLs are trimmed (query+fragment dropped), duplicate link names collapsed, and the list capped at 150 with `… +N more` (narrow with `scope`/`roles`). Drive off these refs.
- **full** — `detail="full"`. The raw a11y tree, untrimmed and uncapped.

`read`/`screenshot`/`evaluate`/`exportCookies` return their own result instead (see below).

## Args

| Parameter | Type | Description |
|-----------|------|-------------|
| `action` | enum | `navigate` \| `click` \| `fill` \| `select` \| `inspect` \| `read` \| `screenshot` \| `evaluate` \| `exportCookies` |
| `sessionId` | string | **Required.** Persistent page identity across calls |
| `url` | string | Target (navigate) |
| `selector` | string | CSS selector, or `@eN` ref from the **latest** snapshot |
| `value` | string | Text to type (fill) or option to choose (select) |
| `timeoutSeconds` | number | Per-action timeout |
| `browserBackend` | enum | `cloak` (default) \| `playwright` |
| `proxy` | string \| string[] | Proxy URL for the session. An **array** rotates round-robin per call (next proxy per new `sessionId`); the chosen proxy is pinned at session-context creation |
| `timezone` | string | IANA timezone for the session context (e.g. `Europe/Paris`). Binds at session creation |
| `locale` | string | BCP-47 locale for the session context (e.g. `fr-FR`). Binds at session creation |
| `browserProfile` | string | User-agent string for the session context. Binds at session creation |
| `saveSession` | boolean | Persist cookies/storage for later reuse of this `sessionId` |
| `storeCapture` | boolean | Persist the result as a retrievable `responseId` (read/inspect/screenshot/evaluate) |
| `format` | enum | Output format for `read` (markdown default) |
| `detail` | enum | Snapshot shape: `outline` \| `interactive` \| `full`. `navigate` defaults to `outline`; `scope`/`roles` imply `interactive` |
| `scope` | string | CSS selector — snapshot only that region's interactive elements (navigate/inspect) |
| `roles` | string[] | Keep only these ARIA roles in the snapshot, e.g. `["textbox","button"]` |
| `linesMatching` | string[] | `read`: grep the page body; return matching lines instead of the orientation digest |
| `contextLines` | number | `read`: lines of context around each `linesMatching` hit |
| `caseSensitive` | boolean | `read`: case-sensitive `linesMatching` (default: insensitive) |
| `fullPage` | boolean | Full-page screenshot instead of viewport (screenshot) |
| `script` | string | JavaScript to run in the page (evaluate) |
| `scopeUrl` | string | Cookie scope URL (exportCookies; also required when `syncCookiesToHttpSession`) |
| `targetSessionId` | string | HTTP session id to receive exported cookies (default: same `sessionId`) |
| `syncCookiesToHttpSession` | boolean | After the action, also export `scopeUrl` cookies into the HTTP jar |

## The ref loop

Refs come **from** a snapshot you have already read. You cannot act on a `@eN` you have not observed.

```
1. navigate  → returns an OUTLINE (landmarks, role counts, headings — no refs)
2. drill    → navigate/inspect with scope="<css>" or roles=["textbox",…] → interactive @eN refs
3. read the refs, pick one
4. click/fill @eN
5. returns a NEW interactive snapshot (DOM changed → refs re-numbered)
6. act off the new refs …
```

`@eN` refs are **positional and per-snapshot** — they resolve only against the most recent snapshot's ref map and go stale after any DOM change. CSS selectors are stable across changes; prefer them for known elements, refs for discovered ones.

## Examples

```
# Start a session and land on a page (returns an OUTLINE: landmarks, role counts, headings — no refs)
web_browser action=navigate sessionId="s1" url="https://example.com/login"

# Drill to interactive @eN refs — scope to a region, or filter to input roles
web_browser action=navigate sessionId="s1" url="https://example.com/login" scope="form"
web_browser action=inspect  sessionId="s1" roles=["textbox","button"]

# Re-read the current page's interactive elements (full interactive list)
web_browser action=inspect sessionId="s1"

# Fill by CSS selector
web_browser action=fill sessionId="s1" selector="#email" value="user@example.com"

# Fill by ref from the latest snapshot
web_browser action=fill sessionId="s1" selector="@e7" value="hunter2"

# Click by ref
web_browser action=click sessionId="s1" selector="@e9"

# Choose a dropdown option
web_browser action=select sessionId="s1" selector="#country" value="US"

# Persist cookies/storage; reuse the same sessionId later to resume
web_browser action=navigate sessionId="s1" url="https://example.com" saveSession=true

# Opt out of CloakBrowser
web_browser action=navigate sessionId="s1" url="https://example.com" browserBackend=playwright
```

## Read, screenshot, evaluate, exportCookies

These four act on the **current** live page (after your clicks/fills, no re-navigation) and return their own result instead of a snapshot.

```
# Read (bare) → cheap orientation digest: counts, heading outline with line numbers, landmarks
web_browser action=read sessionId="s1"

# Grep the live body → only matching lines (+ context); skips the full-page dump
web_browser action=read sessionId="s1" linesMatching=["total","subtotal"] contextLines=1

# Read the post-interaction DOM → markdown; persist full body for web_extract
web_browser action=read sessionId="s1" format=markdown storeCapture=true
web_extract responseId="<id>" action=adhoc prompt="list orders"

# Screenshot → writes a PNG to disk, returns blobPath + responseId
web_browser action=screenshot sessionId="s1"
web_browser action=screenshot sessionId="s1" fullPage=true
web_browser action=screenshot sessionId="s1" selector="@e9"   # element only

# Run JS in the page → JSON-serialized result
web_browser action=evaluate sessionId="s1" script="document.title"

# Copy session cookies for a scope into the HTTP cookie jar
web_browser action=exportCookies sessionId="s1" scopeUrl="https://site.com"
```

⚠️ **Never read the screenshot PNG into a text-only model's context.** The result is text-only by design (`blobPath` + `responseId`, the bytes are *not* inlined). Reading the file injects an `image_url` content block, which text-only providers reject with `400 ... unknown variant 'image_url', expected 'text'`. Hand the `blobPath`/`responseId` to a vision-capable step instead.

- **`evaluate`** runs arbitrary JS — same trust boundary as `click`/`fill`. 30 s default timeout; output JSON-serialized and capped at 10 000 chars.
- **`exportCookies`** returns **counts + domains only, never cookie values**. Scoped by `scopeUrl` and SSRF-guarded. `targetSessionId` picks the receiving HTTP session (default: same `sessionId`).

## Hand off to the rest of the suite

`web_browser` only **drives** — by design it has no RAG chunking, `saveToFile`, vertical extractors, summarize, or diff. Don't stop here: it's one tool in a suite, and every other tool can pick up where it left off. Reach for the right one instead of forcing the job into `web_browser`:

| Want | Tool | Call |
|------|------|------|
| RAG chunks | `web_scrape` | `chunks=true maxTokens=… overlapTokens=…` |
| Save body to a file | `web_scrape` | `saveToFile=true` (or `{dir,name}`) |
| YouTube transcript, GitHub, npm, Reddit, arxiv, … | `web_extract action=vertical` | `extractor="youtube" url=…` |
| Summarize / ad-hoc LLM extract | `web_extract` | `action=summarize` / `action=adhoc prompt=…` |
| Snapshot + diff over time | `web_scrape` | `snapshotName="…"` / `diff=true` |
| API-surface extraction | `web_extract` | `extract="api-surface"` |

**Most of these need no session — for public content, just call them directly** (e.g. a YouTube transcript is `web_extract action=vertical extractor=youtube`, no browser at all). The `sessionId` only matters when the content is **behind the login / JS you drove**. Two ways to carry that context over:

**1. Re-render in the shared context** — `mode=browser` + the same `sessionId`. The other tool opens a new tab in your authed, fingerprinted context and re-navigates to the URL you pass:

```
# Log in by driving the page
web_browser action=navigate sessionId="s1" url="https://site.com/login"
web_browser action=fill     sessionId="s1" selector="#user" value="me"
web_browser action=fill     sessionId="s1" selector="#pass" value="secret"
web_browser action=click    sessionId="s1" selector="@e9"

# Same authed context — now chunk / save / extract behind the login
web_scrape  url="https://site.com/dashboard" mode=browser sessionId="s1" chunks=true maxTokens=800
web_scrape  url="https://site.com/report"    mode=browser sessionId="s1" saveToFile=true
web_extract url="https://site.com/orders"    mode=browser sessionId="s1" action=adhoc prompt="list orders"
```

**2. Capture once, extract from the snapshot** — when the page state is ephemeral (a post-click DOM you can't re-reach by URL), `read storeCapture=true` → `responseId`, then feed that straight to `web_extract` (no re-navigation, exact driven DOM):

```
web_browser action=read    sessionId="s1" storeCapture=true        # → responseId
web_extract responseId="<id>" action=adhoc prompt="list orders"    # extracts the captured DOM
```

- The other tools open a **new tab** in the shared context — they inherit cookies, login, and the browser fingerprint. They re-navigate to the URL you pass.
- `saveSession=true` persists the context to disk; reuse the `sessionId` later (even after a restart) to resume logged-in.
- Continuity holds **only within `mode=browser`**. `mode=fast`/`fingerprint` use a separate cookie jar keyed by the same id — they won't inherit this browser context.

## Rules

- **`sessionId` is required** — the page (cookies, scroll, open tabs) lives under it across calls.
- **One action per call.** No batching: to act on `@eN` you must have seen it in the latest snapshot, and a DOM change between actions re-numbers refs. Observe → act → observe.
- After a click/fill that changes the page, the returned snapshot already reflects the new state — drive off it; don't reuse old refs.
- **Two token ladders keep payloads cheap — start at the top, drill on demand:**
  - *navigate:* **outline** (default — landmarks/role counts/headings, no refs) → **interactive** (`scope`/`roles`, or `detail="interactive"` — `@eN` refs) → **full** (`detail="full"` — raw tree).
  - *read:* **digest** (default — outline + counts) → **`linesMatching`** snippets → **full body** (`storeCapture=true` → `responseId`).
- `navigate` returns an **outline**, not refs — drill with `scope`/`roles` to get `@eN` refs. `click`/`fill`/`select`/`inspect` already return the interactive list. For page prose/markdown use `read`, or `web_scrape` (`mode=browser` shares the same CloakBrowser backend).
- `browserBackend=playwright` needs `npm install playwright` + `npx playwright install chromium`; `cloak` is bundled.
- **`proxy` / `timezone` / `locale` / `browserProfile` bind at session-context CREATION only.** They take effect on the first call that creates the `sessionId`'s context; a session reuses its context and ignores new values on later calls. To change any of them — including rotating to the next proxy in a `proxy` array — use a **new `sessionId`** (an array rotates per call, but each session pins one proxy, so it's "next IP per new session", not a mid-session swap).
- `saveSession=true` persists storageState; reuse the `sessionId` to resume logged-in state.
- Same SSRF route guard as the other tools — loopback/private URLs are blocked.
