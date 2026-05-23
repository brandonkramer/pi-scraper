# `web_extract action="summarize"`

Summarize a single URL or inline content using a model adapter. This action is the successor to the standalone `web_summarize` tool.

## Args

| Parameter | Type | Description |
|-----------|------|-------------|
| `action` | string | Must be `"summarize"` |
| `url` | string | Target URL |
| `content` | string | Inline content (when no URL) |
| `sentences` | number | Target sentence count (1–20) |
| `bullets` | number | Target bullet count (1–20) |
| `provider` | string | Model adapter id, `auto`, or `off` |
| `mode` | enum | Scrape mode to fetch content first |

## Examples

```
# Summarize a URL
web_extract action=summarize url="https://example.com/article"

# With bullet points
web_extract action=summarize url="https://example.com/article" bullets=5

# With sentence count
web_extract action=summarize url="https://example.com/article" sentences=3

# Summarize inline content
web_extract action=summarize content="# Hello World" sentences=2

# With a specific model provider
web_extract action=summarize url="https://example.com" provider="gemini"
```

## Fallback Model Adapter (`@earendil-works/pi-ai`)

For summarizing pages or text using `web_extract action="summarize"`, the scraper employs a tiered fallback adapter system:
- **Primary**: Pi's host model (`ctx.model`).
- **Secondary**: Peer-optional `@earendil-works/pi-ai` adapter (lazy-loaded and auto-registered with priority 30) using custom configs (`piAiProvider`/`piAiModel`).
- **Fallback**: The cross-extension `pi:model-adapter/*` event-bus registry.

This peer-optional design ensures users without custom LLM setups do not need to install heavy AI dependencies.

## Rules

- **Single source only.** No multi-source summarization — use `web_batch` + `compile=true` for multiple pages.
- Requires a model adapter (Pi host model or registered adapter via `provider`).
- Set `provider=off` to disable summarization (falls back to `web_scrape`).
- Content is fetched using the specified `mode`, then passed to the LLM for summarization.
