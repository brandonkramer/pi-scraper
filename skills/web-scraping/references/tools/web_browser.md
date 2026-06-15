# `web_browser`

Drive a **live page** over multiple steps: navigate, click, fill, select, snapshot — plus capture, screenshot, evaluate, exportCookies. **Stateful** — the page persists across calls, keyed by `sessionId`.

> **`mode=browser` vs `web_browser`:** `mode=browser` renders and *reads* one URL (a stateless scrape). `web_browser` *operates* a page across steps (stateful session, clickable `@eN` refs). Different tools — read once vs drive.

## Actions

| Action | Needs | Description |
|--------|-------|-------------|
| `navigate` | `url` | Load a URL in the session's page |
| `click` | `selector` | Click an element |
| `fill` | `selector` + `value` | Type into an input |
| `select` | `selector` + `value` | Choose a `<select>` option |
| `snapshot` | — | Re-read the page's interactive elements |
| `capture` | — | Materialize the live page (post-interaction DOM) as markdown/text/html; add `storeCapture=true` to persist as a `responseId` |
| `screenshot` | — | Save a PNG of the page (or a `selector` element) to disk → `blobPath` + `responseId`. **Binary artifact, not inlined** (see warning below) |
| `evaluate` | `script` | Run JS in the page → JSON-serialized result (30 s default timeout, output capped at 10 000 chars) |
| `exportCookies` | `scopeUrl` | Copy the session's cookies for `scopeUrl` into the HTTP-session cookie jar; returns **counts only, never values** |

`navigate`/`click`/`fill`/`select`/`snapshot` return the current `url` plus a fresh **snapshot**: an interactive-only accessibility tree (links, buttons, inputs, headings) flattened one-per-line, each carrying an `@eN` ref. Drive off those refs. `capture`/`screenshot`/`evaluate`/`exportCookies` return their own result instead (see below).

## Args

| Parameter | Type | Description |
|-----------|------|-------------|
| `action` | enum | `navigate` \| `click` \| `fill` \| `select` \| `snapshot` \| `capture` \| `screenshot` \| `evaluate` \| `exportCookies` |
| `sessionId` | string | **Required.** Persistent page identity across calls |
| `url` | string | Target (navigate) |
| `selector` | string | CSS selector, or `@eN` ref from the **latest** snapshot |
| `value` | string | Text to type (fill) or option to choose (select) |
| `timeoutSeconds` | number | Per-action timeout |
| `browserBackend` | enum | `cloak` (default) \| `playwright` |
| `proxy` | string | Proxy URL for the session |
| `saveSession` | boolean | Persist cookies/storage for later reuse of this `sessionId` |
| `storeCapture` | boolean | Persist the result as a retrievable `responseId` (capture/snapshot/screenshot/evaluate) |
| `format` | enum | Output format for `capture` (markdown default) |
| `fullPage` | boolean | Full-page screenshot instead of viewport (screenshot) |
| `script` | string | JavaScript to run in the page (evaluate) |
| `scopeUrl` | string | Cookie scope URL (exportCookies; also required when `syncCookiesToHttpSession`) |
| `targetSessionId` | string | HTTP session id to receive exported cookies (default: same `sessionId`) |
| `syncCookiesToHttpSession` | boolean | After the action, also export `scopeUrl` cookies into the HTTP jar |

## The ref loop

Refs come **from** a snapshot you have already read. You cannot act on a `@eN` you have not observed.

```
1. navigate  → returns snapshot with @eN refs
2. read the refs, pick one
3. click/fill @eN
4. returns a NEW snapshot (DOM changed → refs re-numbered)
5. act off the new refs …
```

`@eN` refs are **positional and per-snapshot** — they resolve only against the most recent snapshot's ref map and go stale after any DOM change. CSS selectors are stable across changes; prefer them for known elements, refs for discovered ones.

## Examples

```
# Start a session and land on a page (returns a snapshot with @eN refs)
web_browser action=navigate sessionId="s1" url="https://example.com/login"

# Re-read the current page's interactive elements
web_browser action=snapshot sessionId="s1"

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

## Capture, screenshot, evaluate, exportCookies

These four act on the **current** live page (after your clicks/fills, no re-navigation) and return their own result instead of a snapshot.

```
# Serialize the post-interaction DOM → markdown; persist for web_extract
web_browser action=capture sessionId="s1" format=markdown storeCapture=true
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

## Cross-tool sessions

`sessionId` is shared across **all** browser-backed tools — one id maps to one persistent browser context (cookies, localStorage, sessionStorage). **Authenticate once by driving the page, then read/extract the gated pages with the other tools:**

```
# Log in by driving the page
web_browser action=navigate sessionId="s1" url="https://site.com/login"
web_browser action=fill     sessionId="s1" selector="#user" value="me"
web_browser action=fill     sessionId="s1" selector="#pass" value="secret"
web_browser action=click    sessionId="s1" selector="@e9"

# Same authed context — now scrape / extract behind the login
web_scrape  url="https://site.com/dashboard" mode=browser sessionId="s1"
web_extract url="https://site.com/orders" action=adhoc prompt="list orders" mode=browser sessionId="s1"
```

- The other tools open a **new tab** in the shared context — they inherit the login. They re-navigate to the URL you pass.
- `saveSession=true` persists the context to disk; reuse the `sessionId` later (even after a restart) to resume logged-in. `clearSession=true` resets it.
- Continuity holds **only within `mode=browser`**. `mode=fast`/`fingerprint` use a separate cookie jar keyed by the same id — they won't inherit this browser context.

## Rules

- **`sessionId` is required** — the page (cookies, scroll, open tabs) lives under it across calls.
- **One action per call.** No batching: to act on `@eN` you must have seen it in the latest snapshot, and a DOM change between actions re-numbers refs. Observe → act → observe.
- After a click/fill that changes the page, the returned snapshot already reflects the new state — drive off it; don't reuse old refs.
- The snapshot is **interactive-only** (for *driving*). Need page prose, structure, or markdown? Use `web_scrape` (`mode=browser` shares the same CloakBrowser backend).
- `browserBackend=playwright` needs `npm install playwright` + `npx playwright install chromium`; `cloak` is bundled.
- `saveSession=true` persists storageState; reuse the `sessionId` to resume logged-in state.
- Same SSRF route guard as the other tools — loopback/private URLs are blocked.
