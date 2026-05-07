---
name: web-scraping
description: Choose pi-scraper web_* tools.
---

Use for concrete URLs/content only; search/research handles open-ended discovery, multi-source summaries, citations, reports.

Tools: `web_scrape` read URL markdown/text/llm/html/json; `web_summarize` summarize URL/content; `web_map` robots/sitemaps/`llms.txt` URL inventory/no bodies; `web_crawl` follow links/read pages/run/status/list/`crawlId`; `web_batch` independent URLs/per-URL; `web_diff` compare URL snapshot; `web_extract` verticals/markers/regex/excerpts/LLM JSON/schema.

Rules: map inventory, crawl read pages; prefer vertical/pattern before ad hoc LLM; `refresh` time-sensitive; browser/fingerprint/proxy only by request/static failure; no CAPTCHA/stealth/proxy rotation/brand. Verticals: npm, docsite, reddit(no bypass), deepwiki.
