# `web_crawl`

Follow links and read pages. Supports run, status, list, and resume.

## Actions

Inferred from params or explicit `action=`.

| Action | Trigger | Description |
|--------|---------|-------------|
| `run` | `url` + optional `maxPages` | Start a new crawl |
| `status` | `crawlId` (without `url`) | Check crawl progress |
| `list` | `seed`, `status`, or `limit` | List stored crawls |
| `resume` | `crawlId` + `resume=true` | Continue a stored crawl |

## Args

| Parameter | Type | Description |
|-----------|------|-------------|
| `url` | string | Seed URL |
| `crawlId` | string | Stored crawl identifier |
| `maxPages` | number | Max pages to visit |
| `maxDepth` | number | Max link-following depth |
| `sameOrigin` | boolean | Stay on same origin |
| `seedSitemap` | boolean | Seed from sitemap URLs |
| `mode` | enum | Scrape mode for each page |
| `strategy` | enum | `bfs` (default), `dfs`, or `best-first` |
| `proxy` | string \| string[] | Single proxy for whole crawl, or array rotated per page |
| `include` | string[] | URL patterns to include |
| `exclude` | string[] | URL patterns to exclude |
| `extract` | string | `api-surface` to build API module index |
| `compile` | boolean | Build structured context package |
| `concurrency` | number | Global concurrency limit |
| `perHostConcurrency` | number | Per-host concurrency limit |
| `resume` | boolean | Resume a stored crawl |
| `sessionId` | string | Stateful flows across crawl pages |
| `saveSession` | boolean | Persist session |
| `clearSession` | boolean | Reset session |
| `stealth` | boolean | Anti-detection (browser mode) |
| `autoWait` | boolean | Wait for idle (browser mode) |

## Examples

```
# Basic crawl
web_crawl url="https://example.com" maxPages=10

# Deep crawl with strategy
web_crawl url="https://example.com/docs" maxPages=50 strategy=best-first maxDepth=10

# DFS crawl (depth-first)
web_crawl url="https://example.com" maxPages=20 strategy=dfs

# Per-page proxy rotation: page requests use proxy1, proxy2, proxy1, proxy2...
web_crawl url="https://example.com" maxPages=20 proxy=["http://proxy1:8080","http://proxy2:8080"]

# SOCKS proxy in static modes
web_crawl url="https://example.com" maxPages=20 mode=fast proxy=["socks5://127.0.0.1:9050","http://proxy2:8080"]

# With API surface extraction
web_crawl url="https://example.com/docs" maxPages=20 extract=api-surface

# Check crawl status
web_crawl crawlId="abc-123"

# Resume a stored crawl
web_crawl crawlId="abc-123" resume=true maxPages=20

# List stored crawls for a seed
web_crawl seed="https://example.com"

# Bot-protected site
web_crawl url="https://bot-protected.example" maxPages=10 mode=fingerprint
```

## Crawl Strategies

When using `web_crawl` to explore websites and build local datasets or context packages, choose the most appropriate link discovery strategy:
- **`bfs` (Default)**: Breadth-first search. Explores sibling pages at the current depth before diving deeper. Ideal for comprehensive site mapping.
- **`dfs`**: Depth-first search. Follows links as deep as possible before backtracking. Best for traversing deep hierarchical structures, books, documentation sub-trees, or nested forum threads.
- **`best-first`**: Prioritizes pages with the highest structural/index value. The frontier uses a custom structural scoring algorithm (`depth × 10 + URL pattern bonus`) that prioritizes index/hub and section pages over deep leaf-node content.

The active crawl strategy is displayed directly in the TUI progress status line.

## Proxy configuration

- **Single proxy**: `proxy="http://proxy:8080"` uses the same explicit proxy for every page.
- **Per-page rotation**: `proxy=["a", "b", "c"]` resolves before each page scrape, producing `a, b, c, a, b` over five pages.
- **Env auto-config**: when `proxy` is omitted, each page can use `HTTPS_PROXY`/`HTTP_PROXY`/`ALL_PROXY` based on target scheme; `NO_PROXY` bypasses env-derived proxies.
- **Static-mode schemes**: `fast` and `readable` support `http://`, `https://`, `socks5://`, `socks://`, and `socks4://` proxy URLs.
- **Local DNS for SOCKS**: SOCKS target hostnames are resolved locally before CONNECT for SSRF validation. `socks5h://` and `socks4a://` are rejected.
- **Fingerprint caveat**: prefer HTTP(S) proxies in `mode=fingerprint`; SOCKS hostname targets fail closed.

## Rules

- Prefer `web_extract action=github_repo` for GitHub repos — don't crawl github.com.
- Each crawl is stored under `~/.pi/crawl/:crawlId/` for status/resume.
- Use `compile=true` for downstream agent context packaging.
- Use `extract=api-surface` for documentation sites to build a module index.
- `strategy=best-first` prioritizes pages with the highest structural/index value using a custom structural scoring algorithm.
- `strategy=dfs` goes deep before wide (LIFO/stack frontier); useful for nested documentation trees.
- `proxy` can be a single URL (`"http://proxy:8080"`) for the whole crawl or an array for per-page round-robin rotation.
- Crawl progress text now shows the active strategy (BFS, DFS, best-first).

## When to switch tools

- **Site is behind a login**? → authenticate with [`web_browser`](web_browser.md), then `web_crawl mode=browser` with the **same `sessionId`** to crawl the gated pages (shared browser context).
- **Just want a URL inventory**, not page bodies? → [`web_map`](web_map.md). **A single page?** → [`web_scrape`](web_scrape.md).
- **Structured fields per page**? → [`web_extract`](web_extract.md), or `web_crawl extract=api-surface` for a docs module index.
