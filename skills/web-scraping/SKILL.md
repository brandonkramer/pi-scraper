---
name: web-scraping
description: Choose pi-scraper web_* tools for scraping, mapping, crawling, extraction, stored results, and page-scoped workflows.
---

# Web Scraping

Use when selecting a `pi-scraper` tool. pi-scraper is local-first and does not own broad search/research.

## Dispatch

- one URL read/extract as markdown/html/text/json → `web_scrape`
- many independent URLs; per-URL success/failure → `web_batch`
- robots/sitemaps/llms URL inventory only; do not read page bodies → `web_map`
- follow links and read pages recursively; depth/page limits; resume via `crawlId` → `web_crawl`
- brand assets: colors, fonts, logos, favicons, manifest, JSON-LD, Open Graph/Twitter → `web_brand`
- compare current URL with saved/named snapshot; use stable `snapshotName` → `web_diff`
- list deterministic extractor names, URL patterns, schemas, capabilities → `web_list_extractors`
- known-site typed JSON via deterministic API/feed extractor → `web_vertical_scrape`
- arbitrary page/content JSON/schema extraction; LLM/model-backed; no deterministic vertical applies → `web_extract`
- one page/content summary; not multi-source research → `web_summarize`
- retrieve `responseId`, crawl status by `crawlId`, or diff snapshot metadata → `web_get_result`
- prior local scrapes/fetches for one URL; follow `responseId` with `web_get_result` → `web_history`
- prior crawls/status/staleness/recommended action → `web_crawls`
- search stored scrape text with SQLite FTS5; `{ supported: false }` is a clean negative → `web_search_scrapes`

## Rules

- Use search/research companion tools for source discovery, recent/open-ended search, or multi-source synthesis; then scrape selected URLs with `web_scrape`/`web_batch`.
- Prefer `web_map` before `web_crawl` for site structure or URL inventory; use `web_crawl` when the user wants linked pages read.
- For long crawls use stable `crawlId`; repeat same `crawlId` to resume.
- Prefer deterministic `web_vertical_scrape` over ad hoc `web_extract` for supported known sites.
- Use `web_history`/`web_get_result` only when stale data is acceptable. Scrape fresh or set `refresh` for time-sensitive prices/news/status/availability facts.
- Browser/fingerprint/proxy are escalation paths only when requested or static/readable/data-island extraction is insufficient.
- Do not promise CAPTCHA solving, residential proxy rotation, stealth, or guaranteed protected-site access; return structured blocked/error results.

## Special cases

- npm metadata → `web_vertical_scrape` with `.extractor: "npm"`; if only package name given, URL is `https://npmx.dev/package/<name>`. npm page reading (not metadata) → `web_scrape` on that URL.
- DeepWiki URL or sparse GitHub README with DeepWiki coverage → `web_vertical_scrape` with `.extractor: "deepwiki"` on `https://deepwiki.com/owner/repo`.
