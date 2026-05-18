# `web_extract`

Extract structured data from URLs or content. Supports vertical extractors, pattern inspection, CSS/XPath selector extraction, regex excerpts, and LLM-backed adhoc extraction.

## Actions

Inferred from params or explicit `action=`.

| Action | Trigger | Description |
|--------|---------|-------------|
| `vertical` | `extractor` or `action=vertical` | Known-site vertical extractor |
| `pattern` | `sections`, `regexes`, `excerpts`, `markers`, `jsonPaths` | Deterministic pattern extraction |
| `selector` | `selector` or `action=selector` | CSS/XPath with adaptive fallback |
| `surface` | `extract=api-surface` | API surface extraction |
| `adhoc` | `prompt` or `schema` | LLM-backed extraction |
| `list` | no other params | List available extractors |

## Args

| Parameter | Type | Description |
|-----------|------|-------------|
| `url` | string | Target URL |
| `content` | string | Inline content |
| `action` | string | `vertical`, `pattern`, `selector`, `adhoc`, `list` |
| `extractor` | string | Vertical extractor name (e.g. `github_repo`) |
| `prompt` | string | Adhoc extraction prompt |
| `schema` | object | JSON Schema for adhoc extraction |
| `provider` | string | Model adapter for adhoc |
| `sourceFormat` | string | `json` for JSONPath extraction |
| `include` | string[] | Structural include filters |
| `extractSchema` | object | Schema preset for pattern mode |
| `markers` | array | Start/end marker pairs |
| `contains` | array | Inclusion filters |
| `excerpts` | array | Needle-based excerpt extraction |
| `regexes` | array | Named regex patterns with captures |
| `sections` | array | Heading ranges for doc extraction |
| `jsonPaths` | string[] | JSONPath expressions for JSON content |
| `selector` | string | CSS/XPath selector |
| `selectorType` | string | `css` or `xpath` |
| `identifier` | string | Named selector for adaptive fallback |
| `adaptive` | boolean | Enable adaptive relocation |
| `autoSave` | boolean | Persist adaptive selector |
| `threshold` | number | Adaptive threshold |
| `limit` | number | Max results |
| `attribute` | string | Element attribute to extract |
| `mode` | enum | Scrape mode |
| `respectRobots` | boolean | Default: true |

## Examples

```
# Vertical — GitHub repo
web_extract action=github_repo url="https://github.com/can1357/oh-my-pi"

# Vertical — NPM package
web_extract action=npm url="https://www.npmjs.com/package/express"

# Pattern — sections from README
web_extract action=pattern url=https://raw.githubusercontent.com/vitejs/vite/main/README.md sections=[{start:"## Packages",end:"## Contribution"}]

# Pattern — JSONPath from JSON source
web_extract action=pattern url=https://example.com/data.json sourceFormat=json jsonPaths=["$.items[*].name"]

# Pattern — regex extraction
web_extract action=pattern url=https://example.com regexes=[{name:"emails",pattern:"[\\w.-]+@[\\w.-]+"}]

# Pattern — needle excerpts
web_extract action=pattern url=https://example.com excerpts=[{needle:"TODO",after:100}]

# Selector — CSS extraction with adaptive fallback
web_extract action=selector selector=".product-card" selectorType="css" url="https://example.com/products" identifier="product-list-v1" autoSave=true

# Adhoc — LLM-backed extraction
web_extract action=adhoc url="https://example.com" prompt="Extract all pricing tiers" schema={type:"object",properties:{tiers:{type:"array"}}}

# List available vertical extractors
web_extract action=list
```

## Rules

- **Prefer vertical > pattern > selector > adhoc LLM.** Use the cheapest extraction that works.
- Vertical extractors hit APIs directly (GitHub, npm, PyPI, Reddit, etc.) — no HTML scraping.
- Pattern mode is deterministic and works offline (no LLM needed).
- Selector mode supports adaptive fallback: if a saved selector fails, it tries to relocate it.
- Adhoc mode requires a model adapter (Pi host model or registered adapter).
- See the Vertical extractors table in SKILL.md to match a URL to the right action.
