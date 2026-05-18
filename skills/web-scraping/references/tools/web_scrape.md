# `web_scrape`

Read a single URL or content.

## Args

| Parameter | Type | Description |
|-----------|------|-------------|
| `url` | string | Target URL |
| `content` | string | Inline content (when no URL) |
| `mode` | enum | `fast`, `fingerprint`, `readable`, `browser`, `auto` — see the Modes table in SKILL.md to pick the right one |
| `format` | enum | `markdown`, `text`, `html`, `json`, `raw`, `llm` |
| `task` | string | `summarize` (shorthand to bypass url requirement) |
| `maxChars` | number | Truncate output |
| `timeoutSeconds` | number | Per-request timeout |
| `refresh` | boolean | Bypass cache |
| `respectRobots` | boolean | Default: true |
| `followAlternates` | boolean | Follow `<link rel="alternate">` when content is thin |
| `followMetaRefresh` | boolean | Follow `<meta http-equiv="refresh">` redirects |
| `linesMatching` | string[] | Grep-style line filter |
| `contextLines` | number | Lines of context around matches |
| `caseSensitive` | boolean | Case-sensitive matching |
| `include` | array | CSS selectors for content extraction |
| `exclude` | array | CSS selectors to remove |
| `onlyMainContent` | boolean | Strip nav/ads/sidebars |
| `proxy` | string | Proxy URL |
| `sessionId` | string | Stateful flows (cookies, login, consent) |
| `saveSession` | boolean | Persist session across Pi reloads |
| `clearSession` | boolean | Reset session state |
| `stealth` | boolean | Anti-detection patches (browser mode) |
| `autoWait` | boolean | Wait for network idle (browser mode) |

## Examples

```
# Basic
web_scrape url="https://example.com"

# Fingerprint for bot-protected
web_scrape url="https://bot-protected.example" mode=fingerprint format=markdown

# Raw source with grep
web_scrape url="https://example.com/source.ts" format=raw linesMatching=["TODO","FIXME"]

# With session for login/consent flow
web_scrape url="https://example.com/consent" mode=fingerprint sessionId="my-site" saveSession=true
web_scrape url="https://example.com/dashboard" sessionId="my-site"

# Pipe content instead of URL
web_scrape content="# Hello World" task=summarize

# Readable article extraction
web_scrape url="https://example.com/blog/post" mode=readable
```

## Rules

- **Known-site URL? Check SKILL.md's Vertical extractors table first.** If the URL matches a vertical (GitHub repo, npm package, Reddit post, etc.), use `web_extract` with that action instead — hits APIs directly, avoids HTML scraping.
- Default mode is `fast`. Escalate to `fingerprint` on 403/Cloudflare, `browser` for SPAs.
- Use `sessionId` ONLY when cookies/login/consent state matters — otherwise omit.
- `linesMatching` with `format=raw` is the grep equivalent for source files.
- SSRF checks run at connect AND redirect time.
- Robots.txt is respected by default (`respectRobots: true`). Set to `false` only when you own the target.
