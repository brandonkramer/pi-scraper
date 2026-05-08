# pi-scraper

Crawl, map, and structured extraction for Pi — scraper-first, Pi-native, and local-first.

`pi-scraper` is a Pi extension for reading web pages and small sites. It focuses on fast scraping, recursive crawling, URL/site mapping, brand extraction, content diffing, PDF text extraction, local result history, and deterministic vertical extraction.

Use it when you already have URLs and want to read, crawl, compare, or extract them. Use a companion search/research extension such as [`pi-gemini-acp`](https://github.com/brandonkramer/pi-gemini-acp) when you need broad source discovery or multi-source synthesis first.

## Install

From npm:

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

For repeated local work, Pi can opt into the fetch cache:

```json
{ "url": "https://example.com", "cacheTtlSeconds": 3600 }
```

Omit `cacheTtlSeconds` for always-fresh behavior.

## Requirements

- Node.js `>=22.19.0`
- Pi `>=0.65.0`
- Optional Chromium binaries for `mode: "browser"`

Normal installs include the optional Playwright package but do **not** bundle Chromium browser binaries. Install Chromium only if you need browser rendering:

```bash
npx playwright install chromium
```

If optional dependencies were omitted, first run `npm install playwright` in the `pi-scraper` checkout/install directory.

Managed environments that install browsers separately can set:

```bash
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
```

`mode: "fingerprint"` is an optional static-fetch capability. The package exposes a safe backend boundary for a no-redirect TLS/HTTP fingerprint adapter, but does not bundle a fingerprint backend by default. Without one, fingerprint mode returns structured `FINGERPRINT_BACKEND_MISSING` metadata; other modes continue to work.

## Pi manifest

The package declares its extension entrypoint and packaged skills in `package.json`:

```json
{
  "pi": {
    "extensions": ["./src/index.ts"],
    "skills": ["./skills"]
  }
}
```

## Public tools

| Tool             | Capability                                      | Use it for                                                                                                                                                |
| ---------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `web_scrape`     | Local; model only for `task: "summarize"`       | Read one URL as markdown/text/LLM text/HTML/JSON, including raw Markdown, MDX, RST, and source docstrings.                                                |
| `web_summarize`  | Model/LLM; local scrape input                   | Summarize one URL or provided content; page-scoped only, not multi-source research.                                                                       |
| `web_crawl`      | Local; browser optional through scrape pipeline | Run/resume a breadth-first crawl, inspect crawl status by `crawlId`, list prior crawl metadata, or compile crawled docs into an API-surface tree.         |
| `web_map`        | Local                                           | Discovery-only URL inventory from robots, sitemaps, gzipped sitemaps, `sitemap.xml`, and `llms.txt`; no page-content extraction.                          |
| `web_batch`      | Local; browser optional through scrape pipeline | Scrape many independent URLs with ordered per-URL success/failure results.                                                                                |
| `web_diff`       | Local                                           | Re-scrape, normalize, compare against unnamed, named, or tagged snapshots, and store deterministic diff metadata.                                         |
| `web_extract`    | Local/model depending on action                 | List/run deterministic known-site extractors, inspect text/patterns/symbols, compile API surfaces, or run ad hoc schema/prompt extraction from one input. |
| `web_get_result` | Local                                           | Retrieve a stored response by `responseId`, structured job manifest by `jobId`, or snapshot listing by `snapshotUrl`.                                     |

Capability labels:

| Label            | Meaning                                                                                 |
| ---------------- | --------------------------------------------------------------------------------------- |
| Local            | Runs from local HTTP/parsing/storage code without search API keys.                      |
| Browser optional | Uses lazy Playwright only when requested or auto-escalation justifies it.               |
| Model/LLM        | Needs Pi's selected model or a configured model adapter after scraping clean page text. |

## Common parameters

### Scrape-like tools

Used by `web_scrape`, `web_summarize`, `web_batch`, `web_crawl`, `web_diff`, and `web_extract`.

| Parameter                           | Description                                                                                                                               |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `url` / `urls`                      | HTTP(S) URL or URLs. Private-network and unsupported schemes are blocked by default.                                                      |
| `mode`                              | `auto`, `fast`, `fingerprint`, `readable`, or `browser`. Use `auto` unless the user requests a path.                                      |
| `format`                            | `markdown`, `text`, `llm`, `html`, or `json`.                                                                                             |
| `task`                              | For `web_scrape`: `read` or legacy `summarize`; omitted means `read` unless only `content` is provided.                                   |
| `content` / `sentences` / `bullets` | Summary input and length controls for `web_summarize` and `web_scrape task: "summarize"`.                                                 |
| `include` / `exclude`               | Optional CSS selectors or URL patterns where supported.                                                                                   |
| `onlyMainContent`                   | Prefer main/article-like content.                                                                                                         |
| `timeoutSeconds` / `maxChars`       | Direct timeout/output bounds; rarer `headers`, `maxBytes`, cache TTL, retry/backoff, and profile knobs live in persisted scrape defaults. |
| `respectRobots`                     | Defaults to `true`; disabling must be explicit.                                                                                           |
| `proxy`                             | Optional proxy for supported modes/providers.                                                                                             |
| `refresh`                           | Bypass cache for fresh time-sensitive facts.                                                                                              |

### Crawl and map

| Parameter                            | Description                                                                                        |
| ------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `action`                             | For `web_crawl`: `run`, `status`, or `list`; omitted values are inferred from args.                |
| `maxPages`                           | Maximum pages to crawl or discover.                                                                |
| `maxDepth`                           | Maximum link depth from the seed URL.                                                              |
| `sameOrigin`                         | Defaults to same-origin crawling.                                                                  |
| `include` / `exclude`                | URL pattern filters.                                                                               |
| `concurrency` / `perHostConcurrency` | Bound batch/crawl work while HTTP politeness enforces host limits and reacts to 429/`Retry-After`. |
| `crawlId`                            | Resume/persist crawl state and inspect crawl status.                                               |
| `resume`                             | Resume existing `crawlId` state; defaults to true when available.                                  |
| `seed` / `status` / `limit`          | Filters for `web_crawl` `action: "list"`.                                                          |
| `extract: "api-surface"`             | Compile crawled documentation pages into one hierarchical module/function tree when possible.      |

### Diff snapshots

`web_diff` compares the current normalized page content against a previous snapshot. Pass `snapshotName` to keep a repeatable baseline per URL:

```json
{ "url": "https://example.com", "snapshotName": "homepage" }
```

Reusing the same `snapshotName` compares against and then replaces that named baseline. Pass `snapshotTag` to save release/date baselines, `compareTag` to compare current content against a tagged baseline, and `maxSnapshotAgeSeconds` to warn when the baseline snapshot is too old for time-sensitive comparisons:

```json
{
  "url": "https://example.com/docs",
  "snapshotName": "docs",
  "snapshotTag": "v2.0.0",
  "compareTag": "v1.0.0"
}
```

List available per-URL snapshot tags with `web_get_result`:

```json
{ "snapshotUrl": "https://example.com/docs", "snapshotName": "docs" }
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

Vertical extractors return typed JSON for known sites. They prefer public APIs and feeds over browser or LLM extraction.

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

Use `web_extract` with `action: "list"` to inspect exact runtime declarations, `action: "vertical"` for known-site typed JSON including `docstrings`, `action: "pattern"` for deterministic length/markers/contains/regex/excerpts plus symbol-level `include` filters and `extractSchema` presets (`api-reference`, `changelog`, `faq`, `compatibility-table`) over a URL or provided content, `extract: "api-surface"` for a local hierarchical module/function tree from one URL or provided content, and `action: "adhoc"` for arbitrary pages that need a custom schema or prompt and model-backed extraction.

Reddit support is limited to public post URLs and available structured JSON endpoints. If Reddit blocks access, requires auth, or rate-limits the request, the extractor returns a structured error instead of using browser automation, CAPTCHA solving, proxy rotation, or bot-like HTML scraping.

Substack and Shopify candidates are intentionally not listed as built-ins yet because their reliable machine-readable surfaces vary by publication or storefront.

## Storage, cache, and history

Tool results use Pi's standard shell:

```ts
{
  content: [{ type: "text", text }],
  details: {
    url,
    finalUrl,
    status,
    mode,
    format,
    timing,
    truncated,
    fullOutputPath,
    responseId,
    data
  }
}
```

Large crawl, batch, diff, and scrape outputs are stored locally and returned with a compact summary plus local trace metadata such as `responseId` and `fullOutputPath`.

Inline truncation follows Pi defaults:

- 50KB
- 2000 lines

The storage backend uses a local SQLite metadata index plus content-addressed blob files. Cache reuse is opt-in with `cacheTtlSeconds`; default behavior remains fresh network fetches. Cached results include `cache.cached`, `fetchedAt`, `ageSeconds`, `ttlSeconds`, and `staleness` metadata plus standard `freshness.cachedAt`, `freshness.maxAgeSeconds`, `freshness.ageSeconds`, and `freshness.stale` fields when returned from the fetch cache.

Use freshness controls deliberately:

- `web_crawl` with `action: "list"` or `action: "status"` to inspect prior crawls and decide whether to resume, reuse, or recrawl.
- `web_diff` with `maxSnapshotAgeSeconds` when an old snapshot baseline should be treated as stale.
- `refresh: true` for time-sensitive questions such as prices, news, status pages, availability, or anything the user asks about “now”.

The fetch cache currently records in-memory text/buffer responses. Streamed binary downloads are saved as normal result blobs but are not reused as raw HTTP cache hits.

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

This package includes a small Pi skill, `web-scraping`, with guidance for choosing between scrape/summarize, map, crawl, batch, diff, and merged extraction tools.

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

Benchmark suites live under `bench/suites/`; generated summaries and ignored JSON history live under `bench/results/`. See [`bench/README.md`](bench/README.md) for the current layout and output paths.

Optional browser smoke:

```bash
export PLAYWRIGHT_BROWSERS_PATH="${TMPDIR:-/tmp}/pi-scraper-ms-playwright"
npx playwright install chromium
PI_SCRAPER_BROWSER=1 npm run smoke:browser
```

## License

[MIT](LICENSE)
