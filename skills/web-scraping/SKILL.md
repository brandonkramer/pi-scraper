---
name: web-scraping
description: Use for known URLs/content to scrape/read pages, summarize, map sitemaps/robots/llms, crawl links, batch URLs, diff snapshots, extract JSON/regex/verticals, or get responseId/jobId; not web search/research.
---

Known URL/content only. Not search/research/citations, monitoring, translation, CAPTCHA/stealth/proxy rotation, or brand assets.

Tools:
web_scrape read one URL/content; raw md/mdx/rst/source docs ok.
web_summarize summarize one URL/content; no multi-source.
web_map robots/sitemaps/llms URL inventory; no bodies.
web_crawl follow links/read pages; run/status/list/resume crawlId; extract api-surface; compile package.
web_batch many independent URLs; per-URL failures; compile package.
web_diff compare URL snapshot.
web_extract list/vertical/pattern/adhoc; known sites/docsite/docstrings/npm/reddit/deepwiki; markers/regex/excerpts/include/extractSchema/api-surface; JSON/schema.
web_get_result responseId/jobId/snapshot.

Rules: map=inventory, crawl=read linked pages. Prefer vertical > pattern > adhoc LLM. refresh:true time-sensitive. Browser/fingerprint/proxy only requested/static fail. Reddit no bypass.
