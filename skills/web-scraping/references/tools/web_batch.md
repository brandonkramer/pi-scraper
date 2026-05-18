# `web_batch`

Scrape many independent URLs in parallel.

## Args

| Parameter | Type | Description |
|-----------|------|-------------|
| `urls` | string[] | URLs to scrape (required, min 1) |
| `concurrency` | number | Global concurrency (1–32) |
| `perHostConcurrency` | number | Per-host limit (1–16) |
| `mode` | enum | Scrape mode for each URL |
| `format` | enum | Output format |
| `linesMatching` | string[] | Grep-style line filter |
| `contextLines` | number | Lines of context around matches |
| `caseSensitive` | boolean | Case-sensitive matching |
| `compile` | boolean | Build structured context package |
| `sessionId` | string | Stateful flows |
| `saveSession` | boolean | Persist session |
| `clearSession` | boolean | Reset session |
| `stealth` | boolean | Anti-detection |
| `autoWait` | boolean | Wait for idle |

## Examples

```
# Simple batch
web_batch urls=["https://example.com/page1", "https://example.com/page2"]

# With line matching across all pages
web_batch urls=["https://example.com/a", "https://example.com/b"] linesMatching=["ERROR","WARN"] contextLines=2

# Compile into context package
web_batch urls=["https://docs.example.com/guide", "https://docs.example.com/api"] compile=true

# Fingerprint mode for bot-protected pages
web_batch urls=["https://site1.com", "https://site2.com"] mode=fingerprint
```

## Rules

- Per-URL failures are isolated — one failing URL doesn't affect others.
- Use `compile=true` when the batch results will be fed to an LLM as context.
- `linesMatching` applies a grep filter to each URL's content independently.
