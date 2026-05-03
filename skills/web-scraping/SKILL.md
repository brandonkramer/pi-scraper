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
- Use `web_extract` for ad hoc schema/prompt extraction from an arbitrary page; this needs a model-backed adapter.
- Use `web_summarize` for one-page summaries.
- Use `web_get_result` when a previous scraper/crawl/batch/diff tool returned a `responseId`; use `crawlId` for persisted crawl status metadata, or `snapshotUrl`, `snapshotName`, and `listSnapshots` for diff snapshot metadata.

## Defaults

Prefer local-first paths:

1. Try `web_scrape` with `mode: "auto"`.
2. Use `web_map` before `web_crawl` when the user asks for site structure or URL inventory.
3. For long crawls, pass a stable `crawlId`; call `web_crawl` again with the same `crawlId` to resume, or call `web_get_result` with that `crawlId` to check counts, frontier size, status, last error, and final `responseId`.
4. Use browser mode only when requested or when static/data-island/readable recovery is insufficient.
5. Use a dedicated search/research extension such as `pi-gemini-acp` for broad source discovery or multi-source synthesis, then call `web_scrape` or `web_batch` for deeper reading of selected URLs.

## Provider cautions

- `pi-scraper` is local-first and no longer owns search/research providers.
- If another extension discovers URLs, use `web_scrape` or `web_batch` to read those pages with pi-scraper's URL safety, robots, truncation, and extraction behavior.
- Missing external search/research providers should not affect local scrape, crawl, map, batch, brand, diff, or vertical extraction tools.

## Anti-bot scope

Do not promise CAPTCHA solving, residential proxy rotation, stealth guarantees, or guaranteed access to protected sites. Prefer structured blocked/error results and explicit browser/fingerprint/proxy escalation only when appropriate.
