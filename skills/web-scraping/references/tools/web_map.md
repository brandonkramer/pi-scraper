# `web_map`

Discover URLs from robots.txt, sitemaps, and `llms.txt`. Returns URL inventory — no page bodies.

## Args

| Parameter | Type | Description |
|-----------|------|-------------|
| `url` | string | Site root URL (required) |
| `maxSitemaps` | number | Max sitemaps to explore (1–200) |

## Examples

```
# Basic site map
web_map url="https://example.com"

# Large site with many sitemaps
web_map url="https://docs.example.com" maxSitemaps=50

# Documentation site
web_map url="https://developer.mozilla.org/en-US/"
```

## Rules

- **URLs only.** Use `web_scrape` or `web_crawl` to fetch page content.
- Discovers robots.txt, sitemap.xml, and `llms.txt` automatically.
- Returns a responseId for storing/referencing the map.
- Perfect for inventory before deciding what to scrape or crawl.

## When to switch tools

- **Read the mapped URLs**: one page → [`web_scrape`](web_scrape.md); follow links → [`web_crawl`](web_crawl.md); many independent URLs → [`web_batch`](web_batch.md).
- **Structured fields** from those URLs? → [`web_extract`](web_extract.md).
- **Pages behind a login**? → authenticate with [`web_browser`](web_browser.md) first, then crawl/scrape `mode=browser` with the **same `sessionId`**.
