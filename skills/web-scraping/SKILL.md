---
name: web-scraping
description: Use for known URLs/content to scrape/read, summarize, map robots/sitemaps/llms, crawl links, batch URLs, diff snapshots, extract JSON/regex/verticals/selector, get responseId/jobId, not search/research
---

Tools:
web_scrape read one URL/content; raw md/mdx/rst/source docs ok.
web_summarize summarize one URL/content; no multi-source.
web_map robots/sitemaps/llms URL inventory; no bodies.
web_crawl follow links/read pages; run/status/list/resume crawlId; extract api-surface; compile package.
web_batch many independent URLs; per-URL failures; compile package.
web_diff compare URL snapshot.
web_extract list/vertical/pattern/selector/adhoc; known sites/docsite/docstrings/npm/reddit/deepwiki; markers/regex/excerpts/sections/selector/adaptive; JSON/schema.
web_get_result responseId/jobId/snapshot.

Args: scrape url/content/mode/format/maxChars/refresh; sessionId only for stateful flows, saveSession persists, clearSession resets; crawl action/url/crawlId/maxPages/maxDepth/resume/extract/compile; extract action/extractor/url/content/prompt/schema/include/extractSchema/markers/regexes/sections; selector extraction selector/selectorType/identifier/adaptive/autoSave/threshold/limit/attribute; pattern with sourceFormat=json jsonPaths for JSON field selection; diff url/snapshotName/snapshotTag; batch urls/compile; get responseId/jobId/snapshotUrl.

Example: web_extract action=pattern url=https://raw.githubusercontent.com/vitejs/vite/main/README.md sections=[{start:"## Packages",end:"## Contribution"}].
Example: web_extract action=pattern url=https://raw.githubusercontent.com/openai/openai-cookbook/main/examples/How_to_count_tokens_with_tiktoken.ipynb sourceFormat=json jsonPaths=["$.cells[*].source"] excerpts=[{needle:"tool calls",after:2500}].
Example: web_extract action=selector selector=".product-card" selectorType="css" url="https://example.com/products" identifier="product-list-v1" autoSave=true.

Rules: map=inventory, crawl=read linked pages. Prefer vertical > pattern > selector > adhoc LLM. Use selector for CSS/XPath extraction with adaptive fallback when layout changes. Use sections for README/doc heading ranges. refresh:true time-sensitive. Use sessionId only when prior state matters: cookies/login/consent/locale/cart/dashboard/multi-step batch or crawl; otherwise omit. Browser/fingerprint/proxy only requested/static fail. Reddit no bypass.
