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

## Rules

- Prefer `web_extract action=github_repo` for GitHub repos — don't crawl github.com.
- Each crawl is stored under `~/.pi/crawl/:crawlId/` for status/resume.
- Use `compile=true` for downstream agent context packaging.
- Use `extract=api-surface` for documentation sites to build a module index.
