# `web_summarize`

Summarize a single URL or inline content using a model adapter.

## Args

| Parameter | Type | Description |
|-----------|------|-------------|
| `url` | string | Target URL |
| `content` | string | Inline content (when no URL) |
| `sentences` | number | Target sentence count (1–20) |
| `bullets` | number | Target bullet count (1–20) |
| `provider` | string | Model adapter id, `auto`, or `off` |
| `mode` | enum | Scrape mode to fetch content first |

## Examples

```
# Summarize a URL
web_summarize url="https://example.com/article"

# With bullet points
web_summarize url="https://example.com/article" bullets=5

# With sentence count
web_summarize url="https://example.com/article" sentences=3

# Summarize inline content
web_summarize content="# Hello World\nThis is a test article." sentences=2

# With a specific model provider
web_summarize url="https://example.com" provider="gemini"
```

## Rules

- **Single source only.** No multi-source summarization — use `web_batch` + `compile=true` for multiple pages.
- Requires a model adapter (Pi host model or registered adapter via `provider`).
- Set `provider=off` to disable summarization (falls back to `web_scrape`).
- Content is fetched using the specified `mode`, then passed to the LLM for summarization.
