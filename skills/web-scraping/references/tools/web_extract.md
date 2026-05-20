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
| `content` | string | Inline content (when no URL) |
| `action` | string | `vertical`, `pattern`, `selector`, `adhoc`, `list` |
| `extractor` | string | Vertical name (e.g. `github_repo`) |
| `prompt` | string | Adhoc extraction prompt |
| `schema` | object | JSON Schema for adhoc |
| `selector` | string | CSS/XPath selector |
| `selectorType` | string | `css` or `xpath` |
| `attribute` | string | Extract attribute value from selected elements |
| `sections` | array | Heading ranges `{name,start,end,includeStart,includeEnd,maxChars}` |
| `regexes` | array | Named regex patterns `{name,pattern,flags,captureGroup,maxMatches,contextBefore,contextAfter}` |
| `excerpts` | array | Needle-based excerpts `{needle,before,after,maxOccurrences}` |
| `jsonPaths` | string[] | JSONPath for JSON sources |
| `markers` | array | Start/end marker boundaries |
| `contains` | string[] | Filter results containing specific text |
| `extract` | string | Extraction preset (`api-surface`, `symbol-ref`, etc.) |
| `mode` | enum | `fast`, `fingerprint`, `readable`, `browser`, `auto` |
| `format` | enum | `markdown`, `text`, `llm`, `html`, `json`, `raw` |
| `provider` | string | Model or `auto`/`off` |
| `sentences` | number | Truncate to N sentences |
| `bullets` | number | Format as N bullet points |
| `respectRobots` | boolean | Default: true |
| `sessionId` | string | Stateful flows (cookies, login, consent) |
| `saveSession` | boolean | Persist session |
| `clearSession` | boolean | Reset session state |
| `stealth` | boolean | Anti-detection patches (browser mode) |
| `autoWait` | boolean | Wait for network idle (browser mode) |
| `browserBackend` | enum | `cloak` (default) or `playwright` |
| `sourceFormat` | string | Override source content format |
| `include` | array | CSS selectors for extraction |
| `extractSchema` | object | JSON Schema for structured extraction |
| `length` | string | Output length preset |
| `identifier` | string | Named extraction identifier |
| `adaptive` | boolean | Adaptive selector relocation |
| `autoSave` | boolean | Auto-save extracted results |
| `threshold` | number | Confidence threshold |
| `limit` | number | Result limit |

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

# Marker boundaries
web_extract action=pattern url="https://example.com" markers=[{start:"## Features",end:"## Pricing"}]

# Extract by attribute
web_extract action=selector url="https://example.com" selector="img" attribute="src"

# Browser-rendered vertical extraction
web_extract action=vertical extractor=docsite url="https://developer.mozilla.org/en-US/docs/Web/API/URL" mode=browser browserBackend=cloak

# Vector surface extraction
web_extract action=pattern url="https://example.com" extract=api-surface

# List extractors
web_extract action=list
```

## Rules

- **Prefer vertical > pattern > selector > adhoc LLM.** Use the cheapest extraction that works.
- Vertical extractors default to API/direct HTTP paths because they are faster and more reliable. Use `mode=browser` only as an explicit CloakBrowser fallback; it pre-renders the page, then supplies that rendered page to extractors that call `fetchPage`.
- Pattern mode is deterministic and works offline (no LLM needed).
- Selector mode can target CSS classes (`.card`), IDs (`#price`), tags/attributes (`img[src]`, `a[href]`), or XPath; use pattern/excerpts when matching actual visible text.
- Selector mode supports adaptive fallback: if a saved selector fails, it tries to relocate it.
- For images/files, first extract the URL with selector/pattern, then call `web_scrape saveToFile=true` to download.
- Adhoc mode requires a model adapter (Pi host model or registered adapter).
