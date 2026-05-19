# `web_extract`

Extract structured data from URLs or content — verticals, patterns, selectors, regex excerpts, and LLM-backed adhoc.

## Actions

| Action | Trigger | Description |
|--------|---------|-------------|
| `vertical` | `extractor` or `action=vertical` | Known-site vertical extractor |
| `pattern` | `sections`, `regexes`, `excerpts`, `markers`, `jsonPaths` | Deterministic extraction |
| `selector` | `selector` or `action=selector` | CSS/XPath with adaptive fallback |
| `surface` | `extract=api-surface` | API surface extraction |
| `adhoc` | `prompt` or `schema` | LLM-backed extraction |
| `list` | no other params | List available extractors |

## Common args

| Parameter | Type | Description |
|-----------|------|-------------|
| `url` | string | Target URL |
| `action` | string | `vertical`, `pattern`, `selector`, `adhoc`, `list` |
| `extractor` | string | Vertical name (e.g. `github_repo`) |
| `prompt` | string | Adhoc extraction prompt |
| `schema` | object | JSON Schema for adhoc |
| `selector` | string | CSS/XPath selector |
| `selectorType` | string | `css` or `xpath` |
| `sections` | array | Heading ranges |
| `regexes` | array | Named regex patterns |
| `excerpts` | array | Needle-based excerpts |
| `jsonPaths` | string[] | JSONPath for JSON sources |
| `mode` | enum | Scrape mode |
| `respectRobots` | boolean | Default: true |

## Examples

```
# Vertical — GitHub repo
web_extract action=github_repo url="https://github.com/can1357/oh-my-pi"

# Pattern — sections from README
web_extract action=pattern url=https://raw.githubusercontent.com/vitejs/vite/main/README.md sections=[{start:"## Packages",end:"## Contribution"}]

# Selector — CSS extraction
web_extract action=selector selector=".product-card" selectorType="css" url="https://example.com/products"

# Adhoc — LLM-backed
web_extract action=adhoc url="https://example.com" prompt="Extract all pricing tiers" schema={type:"object",properties:{tiers:{type:"array"}}}

# List extractors
web_extract action=list
```

## Rules

- **Prefer vertical > pattern > selector > adhoc LLM.** Use the cheapest extraction that works.
- Vertical extractors hit APIs directly — no HTML scraping. Common: `github_repo`, `npm`, `arxiv`.
- Pattern mode is deterministic and works offline (no LLM needed).
- Selector mode supports adaptive fallback: if a saved selector fails, it tries to relocate it.
- Adhoc mode requires a model adapter (Pi host model or registered adapter).
