# pi-scraper

Crawl, map, and structured extraction for Pi — scraper-first, Pi-native, and local-first.

`pi-scraper` reads known URLs and small sites. Use it to scrape, summarize one page, crawl, map URLs, diff snapshots, retrieve stored results, or extract deterministic/structured data.

Use companion search/research extensions such as [`pi-gemini-acp`](https://github.com/brandonkramer/pi-gemini-acp) for broad source discovery or multi-source synthesis.

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
- Pi `>=0.65.0`
- Optional Chromium binaries for `mode: "browser"`

Browser mode lazy-loads Playwright. Chromium is not bundled; install only if needed:

```bash
npx playwright install chromium
```

Set `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` when browsers are managed externally. `mode: "fingerprint"` requires an optional no-redirect fingerprint backend; without one it returns structured `FINGERPRINT_BACKEND_MISSING` metadata.

## Public tools

| Tool             | Capability                                      | Use it for                                                                                                                                                 | Description / Contract | Overhead |
| ---------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------: | -------: |
| `web_scrape`     | Local; model only for `task: "summarize"`       | Read one URL as markdown/text/LLM text/HTML/JSON, including raw Markdown, MDX, RST, and source docstrings.                                                 |                2 / 115 |     +140 |
| `web_summarize`  | Model/LLM; local scrape input                   | Summarize one URL or provided content; page-scoped only, not multi-source research.                                                                        |                 8 / 94 |     +100 |
| `web_crawl`      | Local; browser optional through scrape pipeline | Run/resume a breadth-first crawl, inspect crawl status by `crawlId`, list prior crawl metadata, or compile crawled docs into API-surface/context packages. |                5 / 126 |     +158 |
| `web_map`        | Local                                           | Discovery-only URL inventory from robots, sitemaps, gzipped sitemaps, `sitemap.xml`, and `llms.txt`; no page-content extraction.                           |                 9 / 58 |      +67 |
| `web_batch`      | Local; browser optional through scrape pipeline | Scrape many independent URLs with ordered per-URL success/failure results and optional context-package compilation.                                        |                2 / 140 |     +166 |
| `web_diff`       | Local                                           | Re-scrape, normalize, compare against unnamed, named, or tagged snapshots, and store deterministic diff metadata.                                          |                 4 / 91 |      +82 |
| `web_extract`    | Local/model depending on action                 | List/run deterministic extractors, inspect patterns, compile API surfaces, run selector extraction with adaptive repair, or extract via schema/prompt.     |                7 / 253 |     +289 |
| `web_get_result` | Local                                           | Retrieve a stored response by `responseId`, structured job manifest by `jobId`, or snapshot listing by `snapshotUrl`.                                      |                10 / 56 |      +74 |

Token counts are approximate: **Description** is lightweight public-facing prose only; **Contract** is the full serialized declaration including schema; **Overhead** is the empirical Pi JSON-mode input token delta against a no-tools baseline, which includes provider serialization and hidden wrapper metadata and varies by provider/model.

Capability labels:

| Label            | Meaning                                                                                 |
| ---------------- | --------------------------------------------------------------------------------------- |
| Local            | Runs from local HTTP/parsing/storage code without search API keys.                      |
| Browser optional | Uses lazy Playwright only when requested or auto-escalation justifies it.               |
| Model/LLM        | Needs Pi's selected model or a configured model adapter after scraping clean page text. |

## Parameter quick reference

| Area             | Parameters                                                                                                                                      |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Input            | `url`, `urls`, `content`                                                                                                                        |
| Scrape output    | `mode`, `format`, `onlyMainContent`, `maxChars`, `timeoutSeconds`                                                                               |
| Freshness/safety | `respectRobots` defaults true; use `refresh: true` for time-sensitive facts                                                                     |
| Session          | `sessionId` (name); `saveSession: true` persists cookies/profile to `~/.pi/scraper/`; `clearSession: true` deletes. Survives Pi `/reload`.      |
| Crawl            | `action`, `maxPages`, `maxDepth`, `sameOrigin`, `crawlId`, `resume`, `seed`, `status`, `limit`                                                  |
| Concurrency      | `concurrency`, `perHostConcurrency`; HTTP politeness reacts to 429 and `Retry-After`                                                            |
| Context packages | `compile: true` on `web_crawl`/`web_batch` stores a bounded package artifact                                                                    |
| API surface      | `extract: "api-surface"` builds a local module/function tree when possible                                                                      |
| Diff             | `snapshotName`, `snapshotTag`, `compareTag`, `maxSnapshotAgeSeconds`                                                                            |
| Extract          | `action`, `extractor`, `prompt`, `schema`, `sourceFormat`, `markers`, `contains`, `excerpts`, `regexes`, `sections`, `include`, `extractSchema` |
| Retrieve         | `responseId`, `jobId`, `snapshotUrl`, `snapshotName`, `snapshotTag`                                                                             |

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

**Session example** — log in once and reuse cookies across scrapes:

```text
web_scrape({ url: "https://example.com/login", sessionId: "example", saveSession: true })
web_scrape({ url: "https://example.com/dashboard", sessionId: "example" })
web_batch({ urls: ["https://example.com/page1", "https://example.com/page2"], sessionId: "example" })
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

| Mode          | JavaScript support | Playwright required | Typical latency | Extraction quality               | Best use case                                                                                                                                                                                |
| ------------- | ------------------ | ------------------- | --------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fast`        | No                 | No                  | Lowest          | Good for static pages            | Static HTML, docs, product pages, quick link/text extraction.                                                                                                                                |
| `fingerprint` | No                 | No                  | Low-medium      | Same parser as static path       | Sites that block plain HTTP clients but do not require JavaScript. Requires a configured optional no-redirect fingerprint backend; proxy is rejected until equivalent SSRF guarantees exist. |
| `readable`    | No                 | No                  | Medium          | Higher for articles/main content | Articles, blogs, noisy pages where Readability improves main content.                                                                                                                        |
| `browser`     | Yes                | Yes, optional/lazy  | Highest         | Best for rendered DOM            | JavaScript-rendered pages when static/data-island recovery is insufficient.                                                                                                                  |
| `auto`        | Only if justified  | Only if escalated   | Adaptive        | Adaptive                         | Default. Starts local/static, reuses fetched HTML, tries recovery/readable/fingerprint before browser only when block/rendering signals justify it.                                          |

## Vertical extraction

Vertical extractors return typed JSON for known sites, preferring public APIs/feeds over browser or LLM extraction.

| Extractor             | Input patterns                                    | Primary strategy                | Browser/cloud/LLM requirement                                                            |
| --------------------- | ------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------- |
| `github_repo`         | GitHub repository URLs                            | GitHub public REST API          | No browser; no LLM; no cloud provider beyond public GitHub access.                       |
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
- `respectRobots` defaults to `true`.
- Response body sizes are bounded before allocation and while streaming.
- Browser rendering is optional and lazy-loaded.
- The package may detect bot-block pages and return structured blocked/error results.
- It does **not** promise CAPTCHA solving, residential proxy rotation, stealth guarantees, or guaranteed access to protected sites.

## Packaged skill

Includes the compact `web-scraping` Pi skill for tool routing.

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
