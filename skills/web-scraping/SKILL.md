---
name: web-scraping
description: Choose pi-scraper web_* tools.
---

# Web Scraping

Use for concrete URLs/content. Use search/research companions for open-ended discovery, multi-source summaries, citations, or reports.

## Tool choice

- `web_scrape`: read one URL as markdown/text/llm/html/json.
- `web_summarize`: summarize one URL/provided content only.
- `web_map`: list URLs from robots, sitemaps, `llms.txt`; no page bodies.
- `web_crawl`: follow links/read pages; run/status/list; resumes by `crawlId`.
- `web_batch`: many independent URLs; per-URL results.
- `web_diff`: compare URL with saved/named snapshot.
- `web_extract`: verticals, markers/regex/excerpts, or LLM JSON/schema.

## Rules

Map for URL inventory; crawl when reading pages. Prefer vertical/pattern extraction before ad hoc LLM. Use `refresh` for time-sensitive pages. Browser/fingerprint/proxy only by request or static failure. No CAPTCHA/stealth/proxy rotation/brand tool.

## Vertical hints

npm metadata: `extractor:npm`. Docs/API refs: `docsite`. Reddit public posts: `reddit` and return blocked/rate-limit errors, no bypass. DeepWiki: `deepwiki`.
