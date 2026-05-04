---
name: web-scraping
description: Guidance for choosing pi-scraper web tools for scraping, mapping, crawling, extraction, and page-scoped structured workflows.
---

# Web Scraping

Use this skill when deciding which `pi-scraper` tool to call.

## Tool choice

- Use `web_scrape` to read one URL.
- Use `web_map` to inventory site URLs without fetching page content.
- Use `web_crawl` to recursively fetch and extract pages from a site.
- Use `web_batch` for many independent URLs.
- Use `web_brand` for colors, fonts, logos, favicons, manifests, Schema.org, Open Graph, and Twitter assets.
- Use `web_diff` to compare current content to unnamed or named cached snapshots; pass `snapshotName` for repeatable baselines like `homepage` and reuse names to avoid unbounded local snapshot growth.
- Use `web_list_extractors` before `web_vertical_scrape` to inspect available deterministic extractors and their capabilities.
- Use `web_vertical_scrape` for known site types with deterministic API/feed parsing.
- For npm package metadata, construct or accept `npmx.dev/package/<name>` URLs for the `npm` vertical extractor when the user names a package without a URL; it resolves to compact npm registry endpoints internally. If the user asks to scrape/read an npm package page rather than extract typed metadata, prefer `web_scrape` on `https://npmx.dev/package/<name>` over npmjs.com.
- Use `web_vertical_scrape` with `extractor: deepwiki` for `https://deepwiki.com/owner/repo` URLs. When a GitHub repo README is sparse or when an npm package points to a GitHub repo that has DeepWiki coverage, consider DeepWiki as a fallback for richer generated documentation, architecture diagrams, and section navigation.
- Use `web_extract` for ad hoc schema/prompt extraction from an arbitrary page; this needs a model-backed adapter.
- Use `web_summarize` for one-page summaries.
- Use `web_get_result` when a previous scraper/crawl/batch/diff tool returned a `responseId`; use `crawlId` for persisted crawl status metadata, or `snapshotUrl`, `snapshotName`, and `listSnapshots` for diff snapshot metadata.
- Use `web_history` to find prior scrapes for a URL before deciding whether to refetch; follow returned `responseId` values with `web_get_result`.
- Use `web_crawls` to find prior crawls; `recommendedAction` is `resume` for fresh running/paused crawls, `reuse_results` for fresh or aging done crawls, `recrawl` for stale/expired done crawls, `discard` for old error crawls, and `inspect` otherwise.
- Use `web_search_scrapes` for full-text recall across stored markdown when available; handle `{ supported: false }` as a clean negative result.

## Defaults

Prefer local-first paths:

1. Try `web_scrape` with `mode: "auto"`.
2. Use `web_map` before `web_crawl` when the user asks for site structure or URL inventory.
3. For long crawls, pass a stable `crawlId`; call `web_crawl` again with the same `crawlId` to resume, or call `web_get_result` with that `crawlId` to check counts, frontier size, status, last error, and final `responseId`.
4. Cache is opt-in via `cacheTtlSeconds`; omit it for always-fresh behavior. Pass `cacheTtlSeconds: 3600` to reuse recent text/HTML/API fetches when age is acceptable; streamed binary downloads are stored as result blobs but are not raw fetch-cache hits yet.
5. When using `web_history` or `web_get_result`, check `ageSeconds` and `staleness`; treat `stale` or `expired` rows as candidates for refresh, not authoritative current facts.
6. Use `refresh: true` for time-sensitive content such as prices, news, stock, availability, weather, status pages, or anything the user asks about now/today.
7. Treat `web_crawls` results with `recommendedAction: recrawl` as a seed for a new crawl, not as current data.
8. Prefer `web_history` + `web_get_result` over a fresh `web_scrape` only when the question is not time-sensitive.
9. Use browser mode only when requested or when static/data-island/readable recovery is insufficient.
10. Use a dedicated search/research extension such as `pi-gemini-acp` for broad source discovery or multi-source synthesis, then call `web_scrape` or `web_batch` for deeper reading of selected URLs.

## Provider cautions

- `pi-scraper` is local-first and no longer owns search/research providers.
- If another extension discovers URLs, use `web_scrape` or `web_batch` to read those pages with pi-scraper's URL safety, robots, truncation, and extraction behavior.
- Missing external search/research providers should not affect local scrape, crawl, map, batch, brand, diff, or vertical extraction tools.

## Anti-bot scope

Do not promise CAPTCHA solving, residential proxy rotation, stealth guarantees, or guaranteed access to protected sites. Prefer structured blocked/error results and explicit browser/fingerprint/proxy escalation only when appropriate.
