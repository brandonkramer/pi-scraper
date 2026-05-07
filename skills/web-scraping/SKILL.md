---
name: web-scraping
description: Choose pi-scraper web_* tools.
---

Use pi-scraper for concrete URLs/content only. Use search/research for open-ended discovery, multi-source summaries, citations, reports.

Choose: `web_scrape` read one URL markdown/text/llm/html/json; `web_summarize` summarize one URL/content; `web_map` robots/sitemaps/`llms.txt` URL inventory, no bodies; `web_crawl` follow links/read pages, run/status/list, `crawlId`; `web_batch` many independent URLs, per-URL; `web_diff` compare URL snapshot; `web_extract` verticals, markers/regex/excerpts, LLM JSON/schema.

Rules: map for URL inventory, crawl to read pages; prefer vertical/pattern before ad hoc LLM; `refresh` for time-sensitive pages; browser/fingerprint/proxy only by request/static failure; no CAPTCHA/stealth/proxy rotation/brand tool.

Verticals: npm, docsite, reddit(no bypass), deepwiki.
