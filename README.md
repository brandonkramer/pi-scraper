# pi-scraper

Crawl, map, and structured extraction for Pi — scraper-first, Pi-native, and local-first.

`pi-scraper` reads known URLs and small sites. Use it to scrape, summarize one page, crawl, map URLs, diff snapshots, retrieve stored results, or extract deterministic/structured data.

## Install

```bash
pi install npm:pi-scraper
```

## Quick start

Ask naturally; Pi can choose the right web tool automatically:

```text
Read https://example.com as markdown.
List the URLs available from https://example.com.
Crawl https://example.com, up to 25 pages.
Compare https://example.com against my homepage snapshot.
```

Add `cacheTtlSeconds` when you want opt-in fetch-cache reuse; omit it for fresh fetches.

## Requirements

- Node.js `>=22.19.0`
- Pi `>=0.74.0`
- Optional Chromium binaries for `mode: "browser"`

Browser mode lazy-loads Playwright. Chromium is not bundled; install only if needed:

```bash
npx playwright install chromium
```

Set `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` when browsers are managed externally. `mode: "fingerprint"` uses bundled [`impit`](https://github.com/apify/impit) for Chrome-class TLS fingerprints; no extra install. Native binary is ~8 MB (one prebuild per platform). Set `browserProfile: "chrome"` (default) or `"firefox"`.

## Public tools

| Tool             | Capability                                      | Use it for                                                                                                                                                 | Contract tokens ≈ | Input overhead ≈ |
| ---------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------: | ---------------: |
| `web_scrape`     | Local; model only for `task: "summarize"`       | Read one URL as markdown/text/LLM text/HTML/JSON, including raw Markdown, MDX, RST, and source docstrings.                                                 |               329 |             +140 |
| `↳ diff`        | Local                                           | Compare current content against stored snapshot baseline via `diff: true` or `diff: { snapshotName, ... }`.                                               | — (folded into web_scrape) | — |
| `web_crawl`      | Local; browser optional through scrape pipeline | Run/resume a breadth-first crawl, inspect crawl status by `crawlId`, list prior crawl metadata, or compile crawled docs into API-surface/context packages. |               181 |             +158 |
| `web_map`        | Local                                           | Discovery-only URL inventory from robots, sitemaps, gzipped sitemaps, `sitemap.xml`, and `llms.txt`; no page-content extraction.                           |                58 |              +67 |
| `web_batch`      | Local; browser optional through scrape pipeline | Scrape many independent URLs with ordered per-URL success/failure results and optional context-package compilation.                                        |               228 |             +166 |
| `web_extract`    | Local/model depending on action                 | List/run deterministic extractors, inspect patterns, compile API surfaces, run selector extraction with adaptive repair, or extract via schema/prompt.     |               323 |             +289 |
| `↳ action=summarize` | Model/LLM; local scrape input | Summarize one URL or provided content via `web_extract action=summarize`. Page-scoped only, not multi-source research. | — (folded into web_extract) | — |
| `web_get_result` | Local                                           | Retrieve a stored response by `responseId`, structured job manifest by `jobId`, or snapshot listing by `snapshotUrl`.                                      |                56 |              +74 |

Token counts are approximate: **Contract** is the full serialized tool declaration including schema; **Input overhead** is the empirical Pi JSON-mode input token delta against a no-tools baseline, which includes provider serialization and hidden wrapper metadata and varies by provider/model.

Capability labels:

| Label            | Meaning                                                                                 |
| ---------------- | --------------------------------------------------------------------------------------- |
| Local            | Runs from local HTTP/parsing/storage code without search API keys.                      |
| Browser optional | Uses lazy Playwright only when requested or auto-escalation justifies it.               |
| Model/LLM        | Needs Pi's selected model or a configured model adapter after scraping clean page text. |

## Parameter quick reference

| Area             | Parameters                                                                                                                                          |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Input            | `url`, `urls`, `content`                                                                                                                            |
| Scrape output    | `mode`, `format`, `onlyMainContent`, `maxChars`, `timeoutSeconds`                                                                                   |
| Freshness/safety | `respectRobots` defaults true; use `refresh: true` for time-sensitive facts                                                                         |
| Session          | `sessionId` only for stateful flows (cookies/login/consent/locale/cart); `saveSession: true` persists across reloads; `clearSession: true` deletes. |
| Crawl            | `action`, `maxPages`, `maxDepth`, `sameOrigin`, `crawlId`, `resume`, `seed`, `status`, `limit`                                                      |
| Concurrency      | `concurrency`, `perHostConcurrency`; HTTP politeness reacts to 429 and `Retry-After`                                                                |
| Context packages | `compile: true` on `web_crawl`/`web_batch` stores a bounded package artifact                                                                        |
| API surface      | `extract: "api-surface"` builds a local module/function tree when possible                                                                          |
| Diff             | `snapshotName`, `snapshotTag` (write via `web_scrape`); `diff: true | {...}` (compare via `web_scrape`); `compareTag`, `maxSnapshotAgeSeconds` |
| Extract          | `action`, `extractor`, `prompt`, `schema`, `sourceFormat`, `markers`, `contains`, `excerpts`, `regexes`, `sections`, `include`, `extractSchema`     |
| Retrieve         | `responseId`, `jobId`, `snapshotUrl`, `snapshotName`, `snapshotTag`                                                                                 |

Examples:

```json
{ "url": "https://example.com", "snapshotName": "homepage" }
```

```json
{ "url": "https://example.com/docs", "compile": true, "extract": "api-surface" }
```

```json
{
  "action": "pattern",
  "url": "https://raw.githubusercontent.com/vitejs/vite/main/README.md",
  "sections": [
    { "name": "packages", "start": "## Packages", "end": "## Contribution" }
  ]
}
```

**Session rule** — default stateless. Use `sessionId` only when prior state affects later requests: cookies, consent, locale, login, cart/account/dashboard, or multi-step crawl/batch. Add `saveSession: true` only when state must survive later tool calls; use `clearSession: true` to reset.

**Session example** — log in once and reuse cookies across scrapes:

```text
web_scrape({ url: "https://example.com/login", sessionId: "example", saveSession: true })
web_scrape({ url: "https://example.com/dashboard", sessionId: "example" })
web_batch({ urls: ["https://example.com/page1", "https://example.com/page2"], sessionId: "example" })
```

**Snapshot example** — pin a baseline, compare against it or the latest baseline:

```text
web_scrape({ url: "https://example.com", snapshotName: "homepage" })       // pin baseline
web_scrape({ url: "https://example.com", diff: { snapshotName: "homepage" } })  // compare against named
web_scrape({ url: "https://example.com", diff: true })                          // compare against latest
```

```json
{ "crawlId": "abc-123", "sessionId": "example", "saveSession": true }
```

````

## Selector extraction

Extract structured content from HTML using CSS selectors, XPath, or text search. Optionally save a fingerprint of the matched element and relocate it later after page layout changes.

```text
Extract all product cards from https://example.com/products with selector .product-card
````

Parameters:

| Parameter      | Type    | Default    | Description                                          |
| -------------- | ------- | ---------- | ---------------------------------------------------- |
| `selector`     | string  | —          | CSS selector, XPath, or text to find                 |
| `selectorType` | string  | "css"      | "css" or "xpath" or "text"                           |
| `attribute`    | string  | —          | Extract a specific attribute instead of text         |
| `identifier`   | string  | (selector) | Stable key for fingerprint storage                   |
| `adaptive`     | boolean | false      | Enable relocation when selector no longer matches    |
| `autoSave`     | boolean | false      | Save fingerprint after a successful match            |
| `threshold`    | number  | 0.35       | Minimum similarity score (0–1) for adaptive fallback |
| `limit`        | number  | 10         | Maximum elements to return                           |

Examples:

```json
// Extract all links with href
{ "url": "https://example.com", "selector": "a", "attribute": "href", "identifier": "example-links", "autoSave": true }

// Extract product cards and save fingerprint for future layout stability
{ "url": "https://example.com", "selector": ".product-card", "identifier": "products-v1", "autoSave": true }

// Later — if the layout changes but the content stays the same
{ "url": "https://example.com", "selector": ".product-card", "identifier": "products-v1", "adaptive": true, "threshold": 0.5 }
```

## Scrape modes

| Mode          | JavaScript support | Playwright required | Typical latency | Extraction quality               | Best use case                                                                                                                                                                                                                               |
| ------------- | ------------------ | ------------------- | --------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fast`        | No                 | No                  | Lowest          | Good for static pages            | Static HTML, docs, product pages, quick link/text extraction.                                                                                                                                                                               |
| `fingerprint` | No                 | No                  | Low-medium      | Same parser as static path       | Sites that block plain HTTP clients but do not require JavaScript. Bundled Chrome/Firefox TLS fingerprint via impit; per-hop SSRF validation owned by pi-scraper. Proxy support deferred (impit's HTTP/3 and proxy are mutually exclusive). |
| `readable`    | No                 | No                  | Medium          | Higher for articles/main content | Articles, blogs, noisy pages where Readability improves main content.                                                                                                                                                                       |
| `browser`     | Yes                | Yes, optional/lazy  | Highest         | Best for rendered DOM            | JavaScript-rendered pages when static/data-island recovery is insufficient.                                                                                                                                                                 |
| `auto`        | Only if justified  | Only if escalated   | Adaptive        | Adaptive                         | Default. Starts local/static, reuses fetched HTML, tries recovery/readable/fingerprint before browser only when block/rendering signals justify it.                                                                                         |

### `fingerprint` mode notes

- **Body size enforcement is incremental, not pre-check.** Response body streams chunk-by-chunk through a `maxBytes`-bounded collector. A server lying about `Content-Length` cannot bypass the limit — actual bytes are counted and the upstream stream is cancelled mid-flight if exceeded. The trade-off: at least one chunk is read before a too-large response can be rejected.
- **DNS rebinding has a residual TOCTOU window.** impit does not expose the connected peer IP, so post-handshake validation is not possible without an upstream change ([apify/impit issue tracker](https://github.com/apify/impit/issues)). We mitigate via a double DNS resolve: pi-scraper resolves at preflight, resolves again immediately before handing off to impit, and rejects with `DNS_REBINDING_DETECTED` if the address sets differ. The residual window is the sub-millisecond gap between the second resolve and impit's actual `connect(2)`. Requires `resolveDns: true` (the default). For arbitrary user-submitted URLs where even a narrow window is unacceptable, set `fingerprintTrustLevel: "untrusted"` to refuse fingerprint mode entirely, or use `mode: "browser"` for Chromium-managed DNS pinning.
- **Proxy support deferred.** impit's `ImpitOptions` makes `proxyUrl` and HTTP/3 mutually exclusive, and HTTP/3 ALPN advertisement is part of the Chrome fingerprint we're impersonating. Until a per-call `disableHttp3` escape hatch lands (or impit upstream supports both simultaneously), use `mode: "fast"` with the standard HTTP client for proxied scrapes.
- **Session cookies fully supported.** `sessionId`, `saveSession`, `clearSession` work identically across `fast` and `fingerprint` modes — cookies persist in pi-scraper's session layer, not in impit's (impit has no cookie jar). Stored cookies travel via the `Cookie` header on each request; `Set-Cookie` responses are persisted to the same session store the fast path uses.

## Vertical extraction

Vertical extractors return typed JSON for known sites, preferring public APIs/feeds over browser or LLM extraction.

| Extractor             | Input patterns                                    | Primary strategy                | Browser/cloud/LLM requirement                                                            |
| --------------------- | ------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------- |
| `github_repo`         | GitHub repository URLs                            | GitHub public REST API (metadata + README + file tree) | No browser; no LLM; no cloud provider beyond public GitHub access.                       |
| `github_issue`        | GitHub issue URLs                                 | GitHub public REST API          | No browser; no LLM; no cloud provider beyond public GitHub access.                       |
| `github_pr`           | GitHub pull request URLs                          | GitHub public REST API          | No browser; no LLM; no cloud provider beyond public GitHub access.                       |
| `github_release`      | GitHub release tag URLs                           | GitHub public REST API          | No browser; no LLM; no cloud provider beyond public GitHub access.                       |
| `npm`                 | npm package URLs                                  | npm registry JSON               | No browser; no LLM.                                                                      |
| `pypi`                | PyPI package URLs                                 | PyPI JSON API                   | No browser; no LLM.                                                                      |
| `crates_io`           | crates.io crate URLs                              | crates.io API                   | No browser; no LLM.                                                                      |
| `docker_hub`          | Docker Hub repository URLs                        | Docker Hub repository API       | No browser; no LLM.                                                                      |
| `huggingface_model`   | Hugging Face model URLs                           | Hugging Face public model API   | No browser; no LLM.                                                                      |
| `huggingface_dataset` | Hugging Face dataset URLs                         | Hugging Face public dataset API | No browser; no LLM.                                                                      |
| `hackernews`          | Hacker News item URLs                             | Hacker News Firebase item API   | No browser; no LLM.                                                                      |
| `reddit`              | Public Reddit post URLs                           | Reddit structured JSON endpoint | No browser; no LLM; returns blocked/rate-limit errors instead of bot-like HTML scraping. |
| `arxiv`               | arXiv abstract/PDF entry URLs                     | arXiv Atom export feed          | No browser; no LLM.                                                                      |
| `deepwiki`            | DeepWiki URLs                                     | Static HTML metadata parsing    | No browser; no LLM.                                                                      |
| `docsite`             | Docs sites, MDN, GitBook, ReadTheDocs, Docusaurus | Static HTML section parsing     | No browser; no LLM; returns `platform` with `unknown` fallback.                          |
| `docstrings`          | Raw `.ts`, `.js`, `.py`, and `.rs` source URLs    | Surface docstring parsing       | No browser; no LLM; extracts documented exports without typechecking.                    |

`web_extract` modes:

- `action: "list"` — inspect runtime extractor declarations.
- `action: "vertical"` — known-site typed JSON, including `docstrings`.
- `action: "pattern"` — deterministic length, markers, contains, regex, excerpts, start/end `sections`, symbol `include`, and `extractSchema` presets.
- `action: "selector"` — CSS/XPath/text selector extraction with optional adaptive fingerprint relocation (see [Selector extraction](#selector-extraction)).
- `extract: "api-surface"` — local hierarchical module/function tree.
- `action: "adhoc"` — custom schema/prompt extraction; model-backed.

Reddit returns structured blocked/rate-limit errors rather than bypassing robots, auth, CAPTCHA, or anti-bot controls. Substack/Shopify are not built-ins yet because reliable machine-readable surfaces vary.

## Storage, cache, and history

Large outputs are stored locally and returned with compact summaries plus `responseId` / `fullOutputPath`. Inline previews follow Pi defaults: 50KB or 2000 lines.

Storage uses a local SQLite metadata index plus content-addressed blobs. Cache reuse is opt-in with `cacheTtlSeconds`; default behavior is fresh network fetches. Use `refresh: true` for time-sensitive facts, `web_crawl action: "list"|"status"` for prior crawl freshness, and `web_diff maxSnapshotAgeSeconds` for stale baselines.

Persistent paths:

| Data             | Path                                                                     |
| ---------------- | ------------------------------------------------------------------------ |
| Config           | `~/.pi/scraper/config/web.json`                                          |
| SQLite index     | `~/.pi/scraper/index.db`                                                 |
| Payload blobs    | `~/.pi/scraper/blobs/<aa>/...`                                           |
| Legacy snapshots | `~/.pi/scraper/snapshots/`                                               |
| Legacy backups   | `~/.pi/scraper/results.bak/`, `~/.pi/scraper/crawl.bak/` after migration |

## Safety and anti-bot scope

- SSRF/private-network protection is applied before fetches and at the HTTP connect/redirect layer.
- HTTP cookies are scoped to the response origin: `Set-Cookie` `Domain` attributes are validated against the response host (RFC 6265 §5.1.3 / §5.3 step 6) and the `Path` attribute follows RFC 6265 default-path semantics (§5.1.4 / §5.2.4 — last valid `Path` wins, invalid values fall back to the request-URI directory).
- In `mode: "browser"`, service workers are blocked, every subresource URL is re-validated through the same SSRF guard, and DNS dedup is per-page so concurrent renders sharing a session cannot bleed safety decisions.
- `respectRobots` defaults to `true`.
- Response body sizes are bounded before allocation and while streaming.
- Browser rendering is optional and lazy-loaded.
- The package may detect bot-block pages and return structured blocked/error results.
- It does **not** promise CAPTCHA solving, residential proxy rotation, stealth guarantees, or guaranteed access to protected sites.

## Packaged skill

Includes the compact `web-scraping` Pi skill for tool routing.

## Configuration command

Use `/scrape-config` to inspect effective settings and persist defaults interactively or via direct arguments.

| Sub-action                    | What it does                                                    |
| ----------------------------- | --------------------------------------------------------------- |
| (no args)                     | Interactive picker (falls back to `status` when UI unavailable) |
| `status`                      | Effective config + live adapter-resolution preview              |
| `model-provider <value>`      | Set `modelProvider` (`auto` / `off` / `<adapter-id>`)           |
| `scrape-mode <mode> [format]` | Set `scrapeMode` + `outputFormat`                               |
| `cache stats`                 | Inspect response cache size and entry counts                    |
| `cache clear`                 | Clear response cache (confirm prompt)                           |
| `robots on/off`               | Toggle `respectRobots` default                                  |
| `reload`                      | Reload config from disk, clearing the in-memory cache           |

The effective config is cached in memory for the session. After hand-editing `~/.pi/scraper/config/web.json`, run `/scrape-config reload` (or restart the session) to pick up changes.

## Model adapters

`web_extract action="summarize"` and `web_extract action="adhoc"` need an LLM transport. When Pi has a model configured (OpenAI, Anthropic, Google, etc.), the tools use it automatically via the host context — no extra extension needed. Any Pi extension can also supply one via `pi.events` for cross-extension provider lending. With no adapter available, the tools return `MODEL_ADAPTER_MISSING` and the LLM falls back to `web_scrape` + summarize-in-reply.

### Capabilities

| Capability  | What it does                                                                      | Used by                      |
| ----------- | --------------------------------------------------------------------------------- | ---------------------------- |
| `summarize` | Page-scoped natural-language summary of scraped content.                          | `web_extract action=summarize` |
| `extract`   | Schema- or prompt-driven structured extraction (JSON shape) from scraped content. | `web_extract action="adhoc"` |

### Configuration

Highest layer wins:

| Layer        | Mechanism                                            | Use                      |
| ------------ | ---------------------------------------------------- | ------------------------ |
| Programmatic | `options.modelAdapter` (test / injected)             | Direct override          |
| Pi host      | `ctx.model` — Pi's currently selected model          | Automatic when available |
| Per-call     | `provider` param on the tool call                    | LLM routes a single call |
| Pi flag      | `--web-model-provider=auto\|<id>\|off`               | Per Pi session           |
| Env var      | `PI_WEB_MODEL_PROVIDER`                              | Shell / scripts          |
| Config file  | `modelProvider` (string or `{ summarize, extract }`) | Persistent default       |
| Default      | `"auto"`                                             | Out-of-box               |

`"auto"` picks the highest-priority adapter that supports the requested capability. `"off"` returns `MODEL_ADAPTER_MISSING` and (at config level) hides the model-backed tools from Pi's tool list.

Errors: `MODEL_ADAPTER_MISSING` (none registered, LLM redirected to `web_scrape`), `MODEL_ADAPTER_NOT_FOUND` (explicit ID unknown — error lists known IDs), `MODEL_ADAPTER_INCOMPATIBLE` (ID registered but lacks the requested capability).

### Event protocol

| Event                         | Direction             | Payload                                 | Purpose                         |
| ----------------------------- | --------------------- | --------------------------------------- | ------------------------------- |
| `pi:model-adapter/register`   | provider → pi-scraper | `entry` (shape in the example below)    | Announce availability           |
| `pi:model-adapter/unregister` | provider → pi-scraper | `{ id }`                                | Withdraw (hot-reload / dispose) |
| `pi:model-adapter/discover`   | pi-scraper → provider | `{ capabilities?, minPriority? } \| {}` | Ask providers to re-announce    |

Adapters **SHOULD** honor the discover filter (capability overlap, `priority >= minPriority`) but **MAY** re-register unconditionally — pi-scraper's resolver filters by capability anyway, so the unfiltered path is harmless, just noisier.

### Implementing an adapter

**Simple** — works for any single-adapter setup:

```ts
const entry = {
  id: "my-adapter",
  label: "My Adapter",
  capabilities: ["summarize"] as const, // summarize | extract
  priority: 50, // higher wins in "auto"
  adapter: {
    async run(req, signal) {
      // req.task | req.input | req.prompt | req.schema (extract only)
      // Return: { data, text?, raw?, usage? }
      //   usage: { provider?, model?, inputTokens?, outputTokens?, totalTokens?, costUSD? }
      //   All usage fields optional — supply what you have.
    },
  },
};

pi.events?.emit?.("pi:model-adapter/register", entry);
pi.events?.on?.("pi:model-adapter/discover", () => {
  pi.events?.emit?.("pi:model-adapter/register", entry);
});
```

**Advanced** — honors the discover filter (cuts re-registration noise in multi-adapter setups) and tidies up on unload:

```ts
pi.events?.on?.("pi:model-adapter/discover", (payload) => {
  const filter = ((payload as object | null) ?? {}) as {
    capabilities?: readonly string[];
    minPriority?: number;
  };

  if (filter.capabilities?.length) {
    const overlap = entry.capabilities.some((c) =>
      filter.capabilities!.includes(c),
    );
    if (!overlap) return;
  }
  if (
    typeof filter.minPriority === "number" &&
    entry.priority < filter.minPriority
  )
    return;

  pi.events?.emit?.("pi:model-adapter/register", entry);
});

pi.events?.emit?.("pi:model-adapter/unregister", { id: entry.id }); // on unload
```

`web_extract action="summarize"` issues a filtered discover (`{ capabilities: ["summarize"] }`) on its first invocation when no `summarize`-capable adapter is registered, then caches per capability so subsequent invocations don't re-emit. `web_extract action="adhoc"` adopts the same pattern.

When an adapter returns `usage`, `web_extract action="summarize"` (and `web_extract action="adhoc"`) render a compact footer in the expanded view, for example: `gemini-acp · gemini-2.0-flash · 234 in · 187 out · $0.0023`. Adapters supply only the fields they have; pi-scraper hides absent fields automatically. Cost is in USD and is the adapter's responsibility to compute — pi-scraper ships no pricing table.

## Development and release checks

Install dependencies from a checkout:

```bash
nvm use 22.19.0
npm install
```

Run the core checks:

```bash
npm run typecheck
npm test
npm run test:tools
npm pack --dry-run
```

Optional checks before a release:

```bash
npm run smoke:install
npm run audit:strict
PI_SCRAPER_LIVE=1 npm run smoke:live
```

Optional browser smoke:

```bash
export PLAYWRIGHT_BROWSERS_PATH="${TMPDIR:-/tmp}/pi-scraper-ms-playwright"
npx playwright install chromium
PI_SCRAPER_BROWSER=1 npm run smoke:browser
```

## License

[MIT](LICENSE)
