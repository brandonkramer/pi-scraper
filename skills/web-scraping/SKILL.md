---
name: web-scraping
description: Choose pi-scraper web_* tools.
---

# Web Scraping

Concrete URLs/content only; use search/research for open-ended discovery, multi-source summaries, citations, reports.

- `web_scrape`: read one URL as markdown/text/llm/html/json.
- `web_summarize`: summarize one URL/provided content only.
- `web_map`: URL inventory from robots/sitemaps/`llms.txt`; no page bodies.
- `web_crawl`: follow links/read pages; run/status/list; `crawlId` resumes.
- `web_batch`: many independent URLs; per-URL results.
- `web_diff`: compare URL with saved/named snapshot.
- `web_extract`: verticals, markers/regex/excerpts, or LLM JSON/schema.

Map for URL inventory; crawl to read pages. Prefer vertical/pattern before ad hoc LLM. Use `refresh` for time-sensitive pages. Browser/fingerprint/proxy only by request/static failure. No CAPTCHA/stealth/proxy rotation/brand tool.

Vertical hints: npm=`extractor:npm`; docs/API=`docsite`; Reddit=`reddit` with blocked/rate-limit errors, no bypass; DeepWiki=`deepwiki`.
