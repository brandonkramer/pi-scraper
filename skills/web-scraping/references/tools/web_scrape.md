# `web_scrape`

Read a single URL or content.

## Args

| Parameter | Type | Description |
|-----------|------|-------------|
| `url` | string | Target URL |
| `content` | string | Inline content (when no URL) |
| `mode` | enum | `fast` (default), `fingerprint` (403/CF), `readable` (articles), `browser` (JS/SPAs), `auto` (adaptive) |
| `format` | enum | `markdown`, `text`, `html`, `json`, `raw`, `llm` |
| `maxChars` | number | Truncate output |
| `timeoutSeconds` | number | Per-request timeout |
| `refresh` | boolean | Bypass cache |
| `respectRobots` | boolean | Default: true |
| `linesMatching` | string[] | Grep-style line filter |
| `contextLines` | number | Lines of context around matches |
| `caseSensitive` | boolean | Case-sensitive matching |
| `include` | array | CSS selectors for extraction |
| `exclude` | array | CSS selectors to remove |
| `onlyMainContent` | boolean | Strip nav/ads/sidebars |
| `proxy` | string \\| string[] | Single proxy or round-robin rotation |
| `sessionId` | string | Stateful flows (cookies, login, consent) |
| `saveSession` | boolean | Persist session |
| `clearSession` | boolean | Reset session state |
| `snapshotName` | string | Save result as named snapshot baseline |
| `snapshotTag` | string | Tag for this snapshot version |
| `diff` | boolean/object | `true` for latest, or `{ snapshotName?, snapshotTag?, compareTag?, maxSnapshotAgeSeconds? }` |
| `saveToFile` | boolean/object | `true` or `{dir,filename,maxBytes}` |
| `stealth` | boolean | Anti-detection patches (browser mode, playwright backend) |
| `autoWait` | boolean | Wait for network idle (browser mode) |
| `browserBackend` | enum | `"cloak"` (default) or `"playwright"` |
| `followAlternates` | boolean | Follow `<link rel="alternate">` content-format fallback |
| `followMetaRefresh` | boolean | Follow `<meta http-equiv="refresh">` redirects |
| `headers` | object | Custom request headers |
| `maxBytes` | number | Max bytes to fetch |
| `sentences` | number | Truncate to N sentences |
| `bullets` | number | Format as N bullet points |
| `task` | string | `read` (default) or `summarize` |
| `chunks` | boolean | Return token-budgeted `chunks[]` alongside full markdown (RAG) |
| `maxTokens` | number | Max tokens per chunk when `chunks=true` (default 500) |
| `overlapTokens` | number | Overlap tokens between chunks (default 50) |

## Examples

```
# Basic
web_scrape url="https://example.com"

# Save snapshot baseline for later diff
web_scrape url="https://example.com" snapshotName="homepage"

# Download to disk
web_scrape url="https://example.com/image.jpg" saveToFile=true

# Custom request headers
web_scrape url="https://api.example.com/data" format=json headers={"Authorization":"Bearer token"}

# Browser diff with persistent session
web_scrape url="https://example.com/dashboard" mode=browser browserBackend=cloak format=markdown sessionId="my-session" saveSession=true diff=true
# Later: compare against it
web_scrape url="https://example.com" diff={"snapshotName":"homepage"}

# Compare against latest baseline (any name)
web_scrape url="https://example.com" diff=true

# Proxy rotation
web_scrape url="https://example.com" proxy=["http://proxy1:8080","http://proxy2:8080","http://proxy3:8080"]

# Single proxy
web_scrape url="https://example.com" proxy="http://proxy:8080"

# RAG: token-budgeted markdown chunks
web_scrape url="https://example.com" chunks=true maxTokens=500 overlapTokens=50

# Fingerprint for bot-protected
web_scrape url="https://bot-protected.example" mode=fingerprint format=markdown

# Raw source with grep
web_scrape url="https://example.com/source.ts" format=raw linesMatching=["TODO","FIXME"]

# Session for login/consent flow
web_scrape url="https://example.com/consent" mode=fingerprint sessionId="my-site" saveSession=true
web_scrape url="https://example.com/dashboard" sessionId="my-site"

```

## Markdown chunks (RAG)

When `chunks=true`, `web_scrape` returns `chunks[]` alongside the full markdown body:
- Paragraph-bounded splits (respects `\n\n` boundaries)
- Each chunk ≤ `maxTokens` (default 500)
- `overlapTokens` (default 50) duplicated at chunk boundaries for context continuity
- Shape: `{ text, tokenCount, index }[]`

## Proxy Pools & Health Tracking

To bypass rate limits, geo-blocks, and IP bans, `pi-scraper` supports a robust proxy pool across both `web_scrape` and `web_crawl`:
- **Syntax**: Pass a single proxy string or an array of string URLs: `proxy=["http://proxy1:8080", "http://proxy2:8080"]`.
- **Health Management**: The built-in proxy pool rotates addresses round-robin. It actively monitors request status; any failed request initiates a **60-second cooldown** for that proxy, and **3 consecutive failures** flags the proxy as unhealthy, removing it from rotation.
- **TLS Fingerprint Integration**: Proxy pools and rotation are fully compatible with bot-bypass TLS fingerprinting (`mode=fingerprint`).

## Rules

- **Known-site URL? Use `web_extract` instead.** If the URL matches a vertical (GitHub repo, npm package, Reddit post, etc.), use `web_extract` with the matching action — hits APIs directly, avoids HTML scraping.
- Default mode is `fast`. Escalate to `fingerprint` on 403/Cloudflare, `browser` for SPAs.
- Use `sessionId` ONLY when cookies/login/consent state matters — otherwise omit.
- `linesMatching` with `format=raw` is the grep equivalent for source files.
- SSRF checks run at connect AND redirect time.
- Robots.txt is respected by default (`respectRobots: true`). Set to `false` only when you own the target.
