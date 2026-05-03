# pi-scraper

Crawl, map, and structured extraction for Pi — scraper-first, Pi-native, and local-first.

`pi-scraper` is a Pi extension for fast page scraping, recursive crawling, URL/site mapping, brand extraction, content diffing, and deterministic vertical extraction. Broad web search and multi-source research are intentionally handled by companion extensions such as `pi-gemini-acp`; use those to find URLs, then use `pi-scraper` to read, crawl, diff, or extract them.

## Install

From npm:

```bash
pi install npm:pi-scraper
```

From a Git checkout for local development:

```bash
git clone <repo-url>
cd pi-scraper
npm install
npm run typecheck
npm test
npm pack --dry-run
# then install the local package with Pi using your normal local-extension workflow
```

## Requirements

- Node.js `>=22.19.0`
- Pi `>=0.65.0`
- Normal install does **not** require Playwright browser binaries.

`pi-scraper` uses Undici 8 for the local HTTP stack, so Node `>=22.19.0` is required.

Optional browser rendering for users that need `mode: "browser"`:

```bash
npm install playwright
npx playwright install chromium
```

`mode: "fingerprint"` is an optional static-fetch capability. The package exposes a safe backend boundary for a no-redirect TLS/HTTP fingerprint adapter, but does not bundle a fingerprint backend by default. Without a configured backend, fingerprint mode returns structured `FINGERPRINT_BACKEND_MISSING` metadata; other modes continue to work.

Managed environments that install browsers separately can set:

```bash
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
```

Optional browser smoke testing from this checkout can install Playwright without saving it to `package.json`:

```bash
nvm use 22.19.0
npm install --no-save --package-lock=false playwright
export PLAYWRIGHT_BROWSERS_PATH="${TMPDIR:-/tmp}/pi-scraper-ms-playwright"
npx playwright install chromium
PI_SCRAPER_BROWSER=1 npm run smoke:browser
```

`PLAYWRIGHT_BROWSERS_PATH` is recommended for the smoke test because the test isolates `HOME` in a temp directory; without an explicit browser cache path, Playwright may not find the Chromium binary it just installed.

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

## Capability labels

| Label            | Meaning                                                                                 |
| ---------------- | --------------------------------------------------------------------------------------- |
| Local            | Runs from local HTTP/parsing/storage code without search API keys.                      |
| Browser optional | Uses lazy Playwright only when requested or auto-escalation justifies it.               |
| Model/LLM        | Needs Pi's selected model or a configured model adapter after scraping clean page text. |

## Public tools

| Tool                  | Capability                                      | Description                                                                                                                         |
| --------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `web_scrape`          | Local; browser/fingerprint optional             | Fetch and extract one URL to markdown, text, LLM text, HTML, or JSON.                                                               |
| `web_crawl`           | Local; browser optional through scrape pipeline | Breadth-first crawl with depth/page limits, robots, resume state, and compact stored results.                                       |
| `web_map`             | Local                                           | Discovery-only URL inventory from robots, sitemaps, gzipped sitemaps, `sitemap.xml`, and `llms.txt`; does not extract page content. |
| `web_batch`           | Local; browser optional through scrape pipeline | Scrape many independent URLs with ordered per-URL success/failure results.                                                          |
| `web_brand`           | Local; browser optional via mode                | Extract colors, fonts, logos, favicons, manifests, JSON-LD, Open Graph, and Twitter assets.                                         |
| `web_diff`            | Local                                           | Re-scrape, normalize, compare against cached snapshots, and store snapshots under `~/.pi/snapshots/`.                               |
| `web_list_extractors` | Local                                           | List deterministic vertical extractors and their browser/cloud/LLM capability declarations.                                         |
| `web_vertical_scrape` | Local/API depending on extractor                | Run known-site extractors that prefer public APIs/feeds over HTML scraping.                                                         |
| `web_extract`         | Model/LLM                                       | Ad hoc schema or prompt extraction from one page after scraping clean text.                                                         |
| `web_summarize`       | Model/LLM                                       | Page-scoped summary after scraping; use a dedicated research/search extension for multi-source synthesis.                           |
| `web_get_result`      | Local storage                                   | Retrieve full stored output by `responseId` from large crawl, batch, diff, or scrape results.                                       |

## Common parameters

### Scrape-like tools

Used by `web_scrape`, `web_batch`, `web_crawl`, `web_brand`, `web_diff`, and scrape-backed extraction tools.

| Parameter                      | Description                                                                                          |
| ------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `url` / `urls`                 | HTTP(S) URL or URLs. Private-network and unsupported schemes are blocked by default.                 |
| `mode`                         | `auto`, `fast`, `fingerprint`, `readable`, or `browser`. Use `auto` unless the user requests a path. |
| `format`                       | `markdown`, `text`, `llm`, `html`, or `json`.                                                        |
| `include` / `exclude`          | Optional CSS selectors for content inclusion/exclusion where supported.                              |
| `onlyMainContent`              | Prefer main/article-like content.                                                                    |
| `timeoutSeconds`               | Per-request timeout.                                                                                 |
| `maxBytes` / `maxChars`        | Response/output bounds.                                                                              |
| `respectRobots`                | Defaults to `true`; disabling must be explicit.                                                      |
| `headers`                      | Optional HTTP headers.                                                                               |
| `proxy`                        | Optional proxy for supported modes/providers.                                                        |
| `browserProfile` / `osProfile` | Optional browser/fingerprint profile hints.                                                          |

### Crawl and map parameters

| Parameter                        | Description                                                                |
| -------------------------------- | -------------------------------------------------------------------------- |
| `maxPages`                       | Maximum pages to crawl or discover.                                        |
| `maxDepth`                       | Maximum link depth from the seed URL.                                      |
| `sameOrigin`                     | Defaults to same-origin crawling.                                          |
| `include` / `exclude`            | URL pattern filters.                                                       |
| `concurrency` / per-host options | Bound crawl work while HTTP politeness also enforces host limits.          |
| `crawlId`                        | Resume/persist crawl state under `~/.pi/crawl/<crawlId>/` where supported. |

### Search and research

`pi-scraper` no longer registers `web_search` or `web_research`. Install a dedicated search/research extension such as `pi-gemini-acp` for source discovery, then pass selected URLs to `web_scrape`, `web_batch`, `web_crawl`, or `web_extract`.

## Scrape modes

| Mode          | JavaScript support | Playwright required | Typical latency | Extraction quality               | Best use case                                                                                                                                            |
| ------------- | ------------------ | ------------------- | --------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fast`        | No                 | No                  | Lowest          | Good for static pages            | Static HTML, docs, product pages, quick link/text extraction.                                                                                            |
| `fingerprint` | No                 | No                  | Low-medium      | Same parser as static path       | Sites that block plain HTTP clients but do not require JavaScript. Requires a configured optional no-redirect fingerprint backend; proxy is rejected until equivalent SSRF guarantees exist. |
| `readable`    | No                 | No                  | Medium          | Higher for articles/main content | Articles, blogs, noisy pages where Readability improves main content.                                                                                    |
| `browser`     | Yes                | Yes, optional/lazy  | Highest         | Best for rendered DOM            | JavaScript-rendered pages when static/data-island recovery is insufficient.                                                                              |
| `auto`        | Only if justified  | Only if escalated   | Adaptive        | Adaptive                         | Default. Starts local/static, reuses fetched HTML, tries recovery/readable/fingerprint before browser only when block/rendering signals justify it.       |

## Vertical extraction strategy

Current built-in deterministic extractors are intentionally small and capability-declared. More known-site extractors can be added under `src/extract/verticals/`.

| Extractor             | Input patterns                | Primary strategy                | Browser/cloud/LLM requirement                                      |
| --------------------- | ----------------------------- | ------------------------------- | ------------------------------------------------------------------ |
| `github_repo`         | GitHub repository URLs        | GitHub public REST API          | No browser; no LLM; no cloud provider beyond public GitHub access. |
| `github_issue`        | GitHub issue URLs             | GitHub public REST API          | No browser; no LLM; no cloud provider beyond public GitHub access. |
| `github_pr`           | GitHub pull request URLs      | GitHub public REST API          | No browser; no LLM; no cloud provider beyond public GitHub access. |
| `github_release`      | GitHub release tag URLs       | GitHub public REST API          | No browser; no LLM; no cloud provider beyond public GitHub access. |
| `npm`                 | npm package URLs              | npm registry JSON               | No browser; no LLM.                                                |
| `pypi`                | PyPI package URLs             | PyPI JSON API                   | No browser; no LLM.                                                |
| `crates_io`           | crates.io crate URLs          | crates.io API                   | No browser; no LLM.                                                |
| `docker_hub`          | Docker Hub repository URLs    | Docker Hub repository API       | No browser; no LLM.                                                |
| `huggingface_model`   | Hugging Face model URLs       | Hugging Face public model API   | No browser; no LLM.                                                |
| `huggingface_dataset` | Hugging Face dataset URLs     | Hugging Face public dataset API | No browser; no LLM.                                                |
| `hackernews`          | Hacker News item URLs         | Hacker News Firebase item API   | No browser; no LLM.                                                |
| `arxiv`               | arXiv abstract/PDF entry URLs | arXiv Atom export feed          | No browser; no LLM.                                                |

Use `web_list_extractors` to inspect the exact capability declarations at runtime. Use `web_extract` for arbitrary pages that need a custom schema/prompt and model-backed extraction.

Reddit, Substack, and Shopify candidates are intentionally not listed as built-ins yet because their reliable machine-readable surfaces vary by community, publication, or storefront. They should be added only with narrow URL support and truthful browser/cloud capability declarations.

## Companion search and research extensions

Use a dedicated provider extension such as `pi-gemini-acp` for Gemini ACP-backed source discovery and grounded research. A typical workflow is:

1. Use `gemini_acp_search` or `gemini_acp_research` from `pi-gemini-acp` to find candidate source URLs.
2. Use `web_scrape` or `web_batch` from `pi-scraper` to read important pages for exact quotes, dates, numbers, or structured extraction.
3. Use `web_get_result` only for stored `pi-scraper` crawl/batch/diff/scrape outputs.

This keeps `pi-scraper` local-first and avoids making scraping, crawling, mapping, brand extraction, or diffing depend on search credentials or Gemini ACP.

## Output, truncation, and storage

Tool results use Pi's standard shell:

```ts
{
  content: ([{ type: "text", text }], details);
}
```

Where applicable, `details` follows a stable envelope with fields such as `url`, `finalUrl`, `status`, `mode`, `format`, `timing`, `truncated`, `fullOutputPath`, `responseId`, and `data`.

Pi inline truncation defaults are preserved:

- 50KB
- 2000 lines

Large crawl, batch, diff, and optionally scrape outputs are stored locally and returned with a compact summary plus `responseId`. Retrieve full content later with `web_get_result`.

Persistent paths:

| Data         | Path                    |
| ------------ | ----------------------- |
| Config       | `~/.pi/config/web.json` |
| Full results | `~/.pi/results/`        |
| Crawl state  | `~/.pi/crawl/`          |
| Snapshots    | `~/.pi/snapshots/`      |

## Safety and anti-bot scope

- SSRF/private-network protection is applied before fetches and at the HTTP connect/redirect layer.
- `respectRobots` defaults to `true`.
- Response body sizes are bounded before allocation and while streaming.
- Browser rendering is optional and lazy-loaded.
- The package may detect bot-block pages and return structured blocked/error results.
- It does **not** promise CAPTCHA solving, residential proxy rotation, stealth guarantees, or guaranteed access to protected sites.

## Packaged skill

This package includes a small Pi skill, `web-scraping`, with user guidance for choosing between scrape, map, crawl, batch, brand, diff, vertical extraction, and page-scoped extraction tools.

## Eval and benchmark scaffolding

Development-only eval material lives outside the npm runtime allowlist:

- `eval/corpus.json` — offline coverage for static articles, docs, products, SPAs with data islands, bot-block pages, PDFs, and noisy marketing pages.
- `bench/README.md` — benchmark plan and source-checkout command notes.

These folders are intentionally not shipped by `npm pack` because `package.json` only includes runtime `src`, `skills`, `README.md`, and `LICENSE`.

## Release checks

Before publishing or recommending a release:

```bash
npm run typecheck
npm test
npm run test:tools
npm run smoke:install
npm run audit:strict
npm pack --dry-run
```

Optional live/browser smoke checks before release:

1. Run `PI_SCRAPER_LIVE=1 npm run smoke:live` to exercise public-network scrape/map paths.
2. For browser mode, run:
   ```bash
   npm install --no-save --package-lock=false playwright
   export PLAYWRIGHT_BROWSERS_PATH="${TMPDIR:-/tmp}/pi-scraper-ms-playwright"
   npx playwright install chromium
   PI_SCRAPER_BROWSER=1 npm run smoke:browser
   ```
3. Install from a local checkout or packed tarball with Pi, reload extensions, and run at least `web_scrape` against a simple public static page.

Do not run `npm publish` without explicit release approval.
