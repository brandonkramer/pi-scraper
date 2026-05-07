---
name: web-scraping
description: Choose pi-scraper web_* tools.
---

# Web Scraping

Use for `pi-scraper` tool choice. Companion tools handle open-ended search/research and multi-source synthesis.

## Dispatch

- `web_scrape` — one URL read as markdown/text/llm/html/json; legacy `task:"summarize"` remains supported.
- `web_summarize` — one URL or provided-content summary; page-scoped only, not multi-source research.
- `web_batch` — many known independent URLs; per-URL results.
- `web_map` — robots/sitemaps/llms URL inventory only; no page bodies.
- `web_crawl` — follow links/read pages; `action:run|status|list`; stable `crawlId` resumes.
- `web_extract` — `list` extractors, `vertical` known-site typed JSON, `pattern` markers/regex/excerpts, `adhoc` LLM JSON/schema.
- `web_diff` — compare URL with saved/named snapshot.

## Rules

- Map before crawl for inventory; crawl only when pages should be read.
- Prefer `web_extract action:vertical` for supported known sites, `pattern` for deterministic text inspection, and `adhoc` only for semantic/schema extraction.
- Use `web_summarize` for page-scoped summaries; companion research tools handle multi-source summaries with citations.
- Use `refresh` for time-sensitive prices/news/status/availability.
- Browser/fingerprint/proxy only by request or when static extraction fails.
- No public brand tool, CAPTCHA solving, proxy rotation, stealth, or guaranteed protected-site access.

## Special

- npm metadata → `web_extract action:vertical extractor:npm url:https://npmx.dev/package/<name>`; npm page reading → `web_scrape`.
- Docs-site sections/API refs → `web_extract action:vertical extractor:docsite` for Docusaurus, ReadTheDocs, GitBook, MDN, or unknown docs pages.
- Reddit public posts → `web_extract action:vertical extractor:reddit`; returns structured blocked/rate-limit errors rather than bypassing robots, auth, CAPTCHA, or anti-bot controls.
- DeepWiki/GitHub docs fallback → `web_extract action:vertical extractor:deepwiki` on `https://deepwiki.com/owner/repo`.
