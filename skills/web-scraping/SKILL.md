---
name: web-scraping
description: Use for known URLs/content to scrape/read with fast or browser mode, summarize, map robots/sitemaps/llms, crawl links, batch URLs, diff snapshots, extract JSON/regex/verticals/selector, get YouTube transcripts/captions, get responseId/jobId, not search/research
---

## How to choose

1. **URL from a known site?** → use `web_extract` with the matching vertical action (table below). Hits APIs directly — no HTML scraping. (GitHub, YouTube transcripts, npm, Reddit, PyPI, arXiv, etc.)
2. **Need the raw page content?** → `web_scrape`. Read a single URL. Add `mode=fingerprint` if bot-protected.
3. **Need JS rendering, bot mitigation, or logged-in pages?** → use `mode=browser` (CloakBrowser default; `browserBackend=playwright` opt-out).
4. **Need a summary?** → `web_extract action=summarize`. **Need structured data?** → `web_extract` with pattern (sections/regex/excerpts), selector (CSS class/ID/attribute/XPath), or adhoc (LLM). For images/files, extract the URL then use `web_scrape saveToFile=true`.
5. **Need to explore a site?** → `web_crawl` to follow links and read pages. Or `web_map` for URL inventory only.
6. **Multiple independent URLs?** → `web_batch` for parallel scraping.
7. **Compare page changes?** → `web_scrape({ url, diff })` against stored snapshots.
8. **Get a previous result back?** → `web_get_result` by responseId, jobId, or snapshot.

## Tools

Each tool has a reference with full args, examples, and rules.

| Tool | When | Ref |
|------|------|-----|
| `web_scrape` | Read a single URL or inline content (check verticals table first for known sites) | [ref](references/tools/web_scrape.md) |
| `web_extract action=summarize` | Summarize via LLM (single source) | [ref](references/tools/web_summarize.md) |
| `web_map` | Inventory URLs from robots/sitemaps/llms (no bodies) | [ref](references/tools/web_map.md) |
| `web_crawl` | Follow links, read pages, build context | [ref](references/tools/web_crawl.md) |
| `web_batch` | Scrape many independent URLs in parallel | [ref](references/tools/web_batch.md) |
| `web_scrape` + `diff` | Diff current content against stored snapshot | [ref](references/tools/web_diff.md) |
| `web_extract` | Vertical/pattern/selector/adhoc extraction | [ref](references/tools/web_extract.md) |
| `web_get_result` | Retrieve stored result by responseId/jobId/snapshot | [ref](references/tools/web_get_result.md) |

## Vertical extractors

Use `web_extract action=<name> url=<url>` — bypasses HTML scraping via site APIs.

| URL matches → | Use action | Ref |
|---------------|-----------|-----|
| `github.com/:owner/:repo` | `github_repo` | [ref](references/verticals/github.md) |
| `github.com/:owner/:repo/issues/:number` | `github_issue` | [ref](references/verticals/github.md) |
| `github.com/:owner/:repo/pull/:number` | `github_pr` | [ref](references/verticals/github.md) |
| `github.com/:owner/:repo/releases/tag/:tag` | `github_release` | [ref](references/verticals/github.md) |
| docs sites (Docusaurus, ReadTheDocs, GitBook, MDN) | `docsite` | [ref](references/verticals/docsite.md) |
| raw `.ts/.tsx/.js/.jsx/.py/.rs` source files | `docstrings` | [ref](references/verticals/docstrings.md) |
| `npmjs.com/package/:name` | `npm` | [ref](references/verticals/package-registries.md) |
| `pypi.org/project/:name` | `pypi` | [ref](references/verticals/package-registries.md) |
| `crates.io/crates/:name` | `crates_io` | [ref](references/verticals/package-registries.md) |
| `hub.docker.com/r/:ns/:repo` or `_/:repo` | `docker_hub` | [ref](references/verticals/docker-hub.md) |
| YouTube video (`watch?v=`, `youtu.be`, `shorts`) — metadata, comments, transcripts/captions | `youtube` | [ref](references/verticals/youtube.md) |
| reddit post (`/r/:sub/comments/:id`, `redd.it/:id`) | `reddit` | [ref](references/verticals/reddit.md) |
| subreddit feed (`/r/:sub` + sort) | `reddit-listing` | [ref](references/verticals/reddit.md) |
| `news.ycombinator.com/item?id=:id` | `hackernews` | [ref](references/verticals/hackernews.md) |
| `deepwiki.com/:owner/:repo` | `deepwiki` | [ref](references/verticals/deepwiki.md) |
| `arxiv.org/abs/:id` or `arxiv.org/pdf/:id` | `arxiv` | [ref](references/verticals/arxiv.md) |
| `huggingface.co/:owner/:model` | `huggingface_model` | [ref](references/verticals/huggingface.md) |
| `huggingface.co/datasets/:owner/:dataset` | `huggingface_dataset` | [ref](references/verticals/huggingface.md) |
| `ossinsight.io/collections` | `ossinsight_collections` | [ref](references/verticals/ossinsight.md) |
| `ossinsight.io/collections/:slug` | `ossinsight_collection_ranking` | [ref](references/verticals/ossinsight.md) |
| `ossinsight.io/trending[/:language]` | `ossinsight_trending_repos` | [ref](references/verticals/ossinsight.md) |
| `ossinsight.io/analyze/:owner/:repo` | `ossinsight_repo_analytics` | [ref](references/verticals/ossinsight.md) |

## Modes

Set `mode=<name>` on scrape/crawl tools when fast isn't enough.

| If this happens → | Use mode | Ref |
|-------------------|----------|-----|
| Default (no issues) | `fast` | [ref](references/modes/fast.md) |
| 403 / Cloudflare / empty shell on fast | `fingerprint` | [ref](references/modes/fingerprint.md) |
| Need clean article text without chrome | `readable` | [ref](references/modes/readable.md) |
| JS-rendered SPA or fingerprint also blocked | `browser` | [ref](references/modes/browser.md) |
| Let it escalate automatically | `auto` | [ref](references/modes/auto.md) |
