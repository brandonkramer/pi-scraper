---
name: web-scraping
description: "Use for known URLs/content to scrape/read with fast or browser mode, summarize, map robots/sitemaps/llms, crawl links, batch URLs, diff snapshots, extract JSON/regex/verticals/selector, get YouTube transcripts/captions, get responseId/jobId, drive/operate a live page interactively (navigate/click/fill/select via web_browser), not search/research. Verticals: github/gitlab/stackoverflow/wikipedia/npm/pypi/crates/docker/youtube/reddit/hn/arxiv/hf/deepwiki/ossinsight/docsite."
---

## How to choose

1. **URL from a known site?** → use `web_extract action=vertical extractor=<name>` with the matching vertical (table below). Hits APIs directly — no HTML scraping. (GitHub, YouTube transcripts, npm, Reddit, Stack Overflow, PyPI, arXiv, Hugging Face, etc.)
  If the vertical returns `URL metadata only`, `404`, empty data, or `not found`, check the vertical's reference page for fallback guidance.
2. **Need the raw page content?** → `web_scrape`. Read a single URL. Add `mode=fingerprint` if bot-protected.
3. **Need JS rendering, bot mitigation, or logged-in pages?** → use `mode=browser` (CloakBrowser default; `browserBackend=playwright` opt-out).
4. **Need a summary?** → `web_extract action=summarize`. **Need structured data?** → `web_extract` with pattern (sections/regex/excerpts), selector (CSS class/ID/attribute/XPath), css-extract/xpath-extract (field-mapped JSON), regex-extract (capture groups), cosine (relevance scoring), or adhoc (LLM). For images/files, extract the URL then use `web_scrape saveToFile=true`.
5. **Need to explore a site?** → `web_crawl` to follow links and read pages (BFS/DFS/best-first). Or `web_map` for URL inventory only.
6. **Multiple independent URLs?** → `web_batch` for parallel scraping.
7. **Compare page changes?** → `web_scrape({ url, diff })` against stored snapshots.
8. **Get a previous result back?** → `web_get_result` by responseId, jobId, or snapshot.
9. **Operate a page (click/fill/submit, multi-step)?** → `web_browser` — stateful driving via `@eN` refs. *Read* a page once → `mode=browser`; *drive* it over steps → `web_browser`.

## Tools

Each tool has a reference with full args, examples, and rules.

| Tool | When | Ref |
|------|------|-----|
| `web_scrape` | Read a single URL or inline content (check verticals table first for known sites) | [ref](references/tools/web_scrape.md) |
| `web_scrape format=raw` | Verify raw server output (no transformations) | [ref](references/tools/web_scrape.md) |
| `web_scrape format=text` | Get plain text with all HTML stripped | [ref](references/tools/web_scrape.md) |
| `web_extract action=summarize` | Summarize via LLM (single source) | [ref](references/tools/web_summarize.md) |
| `web_map` | Inventory URLs from robots/sitemaps/llms (no bodies) | [ref](references/tools/web_map.md) |
| `web_crawl` | Follow links, read pages, build context | [ref](references/tools/web_crawl.md) |
| `web_batch` | Scrape many independent URLs in parallel | [ref](references/tools/web_batch.md) |
| `web_scrape` + `diff` | Diff current content against stored snapshot | [ref](references/tools/web_diff.md) |
| `web_extract` | Vertical/pattern/selector/strategy/adhoc extraction | [ref](references/tools/web_extract.md) |
| `web_get_result` | Retrieve stored result by responseId/jobId/snapshot | [ref](references/tools/web_get_result.md) |
| `web_browser` | Drive a live page: navigate/click/fill/select/inspect + read/screenshot/evaluate/exportCookies (stateful, `sessionId` required) | [ref](references/tools/web_browser.md) |

## Proxy quick rules

- Omit `proxy` to use standard environment variables: `HTTPS_PROXY`/`HTTP_PROXY`/`ALL_PROXY`; `NO_PROXY` bypasses env-derived proxies.
- Explicit `proxy` always wins over env vars.
- Static fetch modes (`fast`, `readable`) support `http://`, `https://`, `socks5://`, `socks://`, and `socks4://` proxy URLs. SOCKS targets are resolved locally before CONNECT for SSRF validation.
- Reject `socks5h://`/`socks4a://`; proxy-side DNS would bypass local DNS/SSRF checks.
- `web_crawl proxy=[...]` rotates per page (`a,b,c,a,b`). `web_scrape proxy=[...]` resolves one proxy for that single scrape call.
- `mode=fingerprint` works with HTTP(S) proxies; SOCKS proxies are only safe for literal-IP targets, so hostname targets fail closed with guidance.

## Vertical extractors

Use `web_extract action=vertical extractor=<name> url=<url>` — bypasses HTML scraping via site APIs.

| URL matches → | Use extractor | Tips | Ref |
|---------------|---------------|------|-----|
| `github.com/:owner/:repo` | `github_repo` | | [ref](references/verticals/github.md) |
| `github.com/:owner/:repo/issues/:number` | `github_issue` | | [ref](references/verticals/github.md) |
| `github.com/:owner/:repo/pull/:number` | `github_pr` | | [ref](references/verticals/github.md) |
| `github.com/:owner/:repo/releases/tag/:tag` | `github_release` | | [ref](references/verticals/github.md) |
| `gitlab.com/:owner/:repo` or self-hosted `:host/:owner/:repo` | `gitlab` | | [ref](references/verticals/gitlab.md) |
| docs sites (Docusaurus, ReadTheDocs, GitBook, MDN) | `docsite` | | [ref](references/verticals/docsite.md) |
| raw `.ts/.tsx/.js/.jsx/.py/.rs` source files | `docstrings` | **Content-based** — pass raw source text via `content:` param, NOT a URL | [ref](references/verticals/docstrings.md) |
| `npmjs.com/package/:name` | `npm` | | [ref](references/verticals/package-registries.md) |
| `pypi.org/project/:name` | `pypi` | | [ref](references/verticals/package-registries.md) |
| `crates.io/crates/:name` | `crates_io` | | [ref](references/verticals/package-registries.md) |
| `hub.docker.com/r/:ns/:repo` or `_/:repo` | `docker_hub` | | [ref](references/verticals/docker-hub.md) |
| YouTube video (`watch?v=`, `youtu.be`, `shorts`) — metadata, comments, transcripts/captions | `youtube` | | [ref](references/verticals/youtube.md) |
| reddit post (`/r/:sub/comments/:id`, `redd.it/:id`) | `reddit` | | [ref](references/verticals/reddit.md) |
| subreddit feed (`/r/:sub` + sort) | `reddit_listing` | | [ref](references/verticals/reddit.md) |
| `news.ycombinator.com/item?id=:id` | `hackernews` | | [ref](references/verticals/hackernews.md) |
| `stackoverflow.com/questions/:id` or `/:id/:slug` | `stackoverflow` | | [ref](references/verticals/stackoverflow.md) |
| `en.wikipedia.org/wiki/:title` or `:lang.wikipedia.org/wiki/:title` | `wikipedia` | | [ref](references/verticals/wikipedia.md) |
| `deepwiki.com/:owner/:repo` | `deepwiki` | Uses **deepwiki.com** (auto-generated code wikis), NOT en.wikipedia.org | [ref](references/verticals/deepwiki.md) |
| `arxiv.org/abs/:id` or `arxiv.org/pdf/:id` | `arxiv` | | [ref](references/verticals/arxiv.md) |
| `huggingface.co/:owner/:model` or legacy `/:model` | `huggingface_model` | | [ref](references/verticals/huggingface.md) |
| `huggingface.co/datasets/:owner/:dataset` or legacy `/datasets/:dataset` | `huggingface_dataset` | | [ref](references/verticals/huggingface.md) |
| `ossinsight.io/collections` | `ossinsight_collections` | Use ossinsight.io URLs, NOT github.com | [ref](references/verticals/ossinsight.md) |
| `ossinsight.io/collections/:slug` | `ossinsight_collection_ranking` | Use ossinsight.io URLs; supports `?metric=` & `?period=` params | [ref](references/verticals/ossinsight.md) |
| `ossinsight.io/trending[/:language]` | `ossinsight_trending_repos` | Use ossinsight.io URLs | [ref](references/verticals/ossinsight.md) |
| `ossinsight.io/analyze/:owner/:repo` | `ossinsight_repo_analytics` | Use **ossinsight.io/analyze/:owner/:repo**, NOT github.com/:owner/:repo | [ref](references/verticals/ossinsight.md) |

### Custom vertical manifests

Need a missing known-site vertical or a local override? Add a project/user YAML manifest; see [custom vertical manifest ref](references/verticals/custom.md).

## Modes

Set `mode=<name>` on scrape/crawl tools when fast isn't enough.

| If this happens → | Use mode | Ref |
|-------------------|----------|-----|
| Default (no issues) | `fast` | [ref](references/modes/fast.md) |
| 403 / Cloudflare / empty shell on fast | `fingerprint` | [ref](references/modes/fingerprint.md) |
| Need clean article text without chrome | `readable` | [ref](references/modes/readable.md) |
| JS-rendered SPA or fingerprint also blocked | `browser` | [ref](references/modes/browser.md) |
| Let it escalate automatically | `auto` | [ref](references/modes/auto.md) |

> **`mode=browser` vs `web_browser`:** `mode=browser` renders and *reads* one URL (a stateless scrape). `web_browser` *drives* a page over multiple steps (stateful session, clickable `@eN` refs). Different tools — read once vs operate.

## Sessions across tools

`sessionId` carries one persistent browser context (cookies/localStorage/sessionStorage) across **every** browser-backed tool. **Authenticate once with `web_browser`, then scrape/extract the gated pages** with the same `sessionId` + `mode=browser`:

```
web_browser action=navigate sessionId="s1" url=".../login"   # drive the login
web_browser action=fill ... ; web_browser action=click ...
web_scrape  url=".../dashboard" mode=browser sessionId="s1"  # same authed context
web_extract url=".../data" action=adhoc prompt="…" mode=browser sessionId="s1"
```

`saveSession=true` persists to disk (resume after a restart); `clearSession=true` resets. Continuity holds only within `mode=browser` — `fast`/`fingerprint` use a separate cookie jar keyed by the same id. The handoff shares the **session** (cookies), not the live page's current view; the other tools open a fresh tab and re-navigate.
