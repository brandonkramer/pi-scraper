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
| `proxy` | string | Proxy URL |
| `sessionId` | string | Stateful flows (cookies, login, consent) |
| `saveSession` | boolean | Persist session |
| `clearSession` | boolean | Reset session state |
| `snapshotName` | string | Save result as named snapshot baseline |
| `snapshotTag` | string | Tag for this snapshot version |
| `stealth` | boolean | Anti-detection patches (browser mode) |
| `autoWait` | boolean | Wait for network idle (browser mode) |

## Examples

```
# Basic
web_scrape url="https://example.com"

# Save snapshot baseline for later diff
web_scrape url="https://example.com" snapshotName="homepage"
# Later: web_diff url="https://example.com" snapshotName="homepage"

# Fingerprint for bot-protected
web_scrape url="https://bot-protected.example" mode=fingerprint format=markdown

# Raw source with grep
web_scrape url="https://example.com/source.ts" format=raw linesMatching=["TODO","FIXME"]

# Session for login/consent flow
web_scrape url="https://example.com/consent" mode=fingerprint sessionId="my-site" saveSession=true
web_scrape url="https://example.com/dashboard" sessionId="my-site"

```

## Rules

- **Known-site URL? Use `web_extract` instead.** If the URL matches a vertical (GitHub repo, npm package, Reddit post, etc.), use `web_extract` with the matching action — hits APIs directly, avoids HTML scraping.
- Default mode is `fast`. Escalate to `fingerprint` on 403/Cloudflare, `browser` for SPAs.
- Use `sessionId` ONLY when cookies/login/consent state matters — otherwise omit.
- `linesMatching` with `format=raw` is the grep equivalent for source files.
- SSRF checks run at connect AND redirect time.
- Robots.txt is respected by default (`respectRobots: true`). Set to `false` only when you own the target.
