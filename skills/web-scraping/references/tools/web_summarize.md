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

## Model adapter resolution (Pi 0.81+)

For summarization, an explicitly injected adapter wins. `provider=auto` then uses Pi's active host model before the cross-extension `pi:model-adapter/*` registry. A named provider selects that registry entry; `provider=off` disables model use even when Pi has an active model.

The configured Pi runtime adapter (`piAiProvider`/`piAiModel`, or `PI_AI_PROVIDER`/`PI_AI_MODEL`) resolves a fixed model through Pi 0.81's model runtime. It forwards authentication, headers, abort signals, provider errors, and Pi usage/cost data.

## Rules

- **Single source only.** No multi-source summarization — use `web_batch` + `compile=true` for multiple pages.
- Requires a model adapter (Pi host model or registered adapter via `provider`).
- Set `provider=off` to disable summarization (falls back to `web_scrape`).
- Content is fetched using the specified `mode`, then passed to the LLM for summarization.
