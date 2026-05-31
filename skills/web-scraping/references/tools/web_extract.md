# `web_extract`

Extract structured data from URLs or content — verticals, patterns, selectors, regex excerpts, and LLM-backed adhoc.

## Actions

| Action | Trigger | Description |
|--------|---------|-------------|
| `vertical` | `extractor` or `action=vertical` | Known-site vertical extractor |
| `pattern` | `sections`, `regexes`, `excerpts`, `markers`, `jsonPaths` | Deterministic extraction |
| `selector` | `selector` or `action=selector` | CSS/XPath with adaptive fallback |
| `surface` | `extract=api-surface` | API surface extraction |
| `css-extract` | `selectors` + `action=css-extract` | Field-mapped CSS: structured JSON per selector |
| `xpath-extract` | `selectors` + `action=xpath-extract` | Field-mapped XPath: structured JSON per selector |
| `regex-extract` | `selectors` + `action=regex-extract` | Regex capture groups → structured JSON |
| `cosine` | `query` + `action=cosine` | TF-IDF cosine relevance scoring of text blocks |
| `adhoc` | `prompt` or `schema` | LLM-backed extraction |
| `list` | no other params | List available extractors |

## Common args

| Parameter | Type | Description |
|-----------|------|-------------|
| `url` | string | Target URL |
| `content` | string | Inline content (when no URL) |
| `action` | string | `vertical`, `pattern`, `selector`, `adhoc`, `list`, `css-extract`, `xpath-extract`, `regex-extract`, `cosine` |
| `extractor` | string | Vertical name used with `action=vertical` (e.g. `github_repo`, `huggingface_model`, `huggingface_dataset`) |
| `prompt` | string | Adhoc extraction prompt |
| `schema` | object | JSON Schema for adhoc |
| `selector` | string | CSS/XPath selector |
| `selectors` | object | Field → selector map for css-extract/xpath-extract/regex-extract |
| `query` | string | Relevance query for cosine scoring |
| `topN` | number | Top-N results for cosine (default 5) |
| `minScore` | number | Minimum cosine score (0–1, default 0) |
| `flags` | string | Regex flags for regex-extract (default `g`) |
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
# Vertical — GitHub repo metadata/README/tree
web_extract action=vertical extractor=github_repo url="https://github.com/can1357/oh-my-pi"

# Vertical — GitIngest LLM-ready codebase digest for a GitHub repo
web_extract action=vertical extractor=gitingest url="https://github.com/coderamp-labs/gitingest"
web_extract action=vertical extractor=gitingest url="https://gitingest.com/coderamp-labs/gitingest?max_file_size=50&pattern_type=include&pattern=src/**/*.py"

# Vertical — Hugging Face model (owner/model or legacy single-slug URL)
web_extract action=vertical extractor=huggingface_model url="https://huggingface.co/google-bert/bert-base-uncased"
web_extract action=vertical extractor=huggingface_model url="https://huggingface.co/bert-base-uncased"

# Vertical — Hugging Face dataset (owner/dataset or legacy single-slug URL)
web_extract action=vertical extractor=huggingface_dataset url="https://huggingface.co/datasets/rajpurkar/squad"
web_extract action=vertical extractor=huggingface_dataset url="https://huggingface.co/datasets/cnn_dailymail"

# Pattern — sections from README
web_extract action=pattern url=https://raw.githubusercontent.com/vitejs/vite/main/README.md sections=[{start:"## Packages",end:"## Contribution"}]

# Selector — CSS extraction
web_extract action=selector selector=".product-card" selectorType="css" url="https://example.com/products"

# CSS-extract — structured field mapping
web_extract action=css-extract url="https://example.com/product/1" selectors={title:"h1",price:".price",description:".desc"}

# XPath-extract — structured field mapping
web_extract action=xpath-extract url="https://example.com" selectors={title:"//h1[@class='article-title']",author:"//p[@class='byline']"}

# Regex-extract — structured capture groups
web_extract action=regex-extract content="some text" selectors={email:"(\\S+@\\S+)",phone:"(\\d{3}-\\d{3}-\\d{4})"}

# Cosine — relevance scoring
web_extract action=cosine url="https://example.com/docs" query="Node.js V8 engine" topN=3 minScore=0.05

# Adhoc — LLM-backed (returns grounded[] with sourceSpan offsets)
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

## Custom vertical manifests

For project/user YAML manifest additions or overrides, see [custom vertical manifest ref](../verticals/custom.md).

## Fallback Model Adapter (`@earendil-works/pi-ai`)

For summarizing or extracting unstructured text (`web_extract action=summarize` or `action=adhoc`), the scraper employs a tiered fallback adapter system:
- **Primary**: Pi's host model (`ctx.model`).
- **Secondary**: Peer-optional `@earendil-works/pi-ai` adapter (lazy-loaded and auto-registered with priority 30) using custom configs (`piAiProvider`/`piAiModel`).
- **Fallback**: The cross-extension `pi:model-adapter/*` event-bus registry.

This peer-optional design ensures users without custom LLM setups do not need to install heavy AI dependencies.

## Rules

- **Prefer vertical > pattern > css-extract > selector > adhoc LLM.** Use the cheapest extraction that works.
- Vertical calls use `action=vertical extractor=<name>`; do not put extractor names such as `huggingface_model` in `action`.
- For structured data from known layouts, use `css-extract` or `xpath-extract` with a `selectors` map.
- For text with predictable patterns (emails, phone numbers, IDs), use `regex-extract`.
- For open-ended content relevance, use `cosine` with a natural language query (pure TS, no LLM needed).
- Vertical extractors default to API/direct HTTP paths because they are faster and more reliable. Use `mode=browser` only as an explicit CloakBrowser fallback; it pre-renders the page, then supplies that rendered page to extractors that call `fetchPage`.
- Pattern mode is deterministic and works offline (no LLM needed).
- Selector mode can target CSS classes (`.card`), IDs (`#price`), tags/attributes (`img[src]`, `a[href]`), or XPath; use pattern/excerpts when matching actual visible text.
- Selector mode supports adaptive fallback: if a saved selector fails, it tries fingerprint-based relocation; if that also fails, it falls back to text-anchor healing (parsing the selector for tag/class/id signals and matching semantic neighbors).
- For images/files, first extract the URL with selector/pattern, then call `web_scrape saveToFile=true` to download.
- Adhoc mode requires a model adapter (Pi host model or registered adapter).
- **Source grounding**: `action=adhoc` automatically post-processes LLM output to locate each extracted string value in the cleaned source text, returning `grounded[]` with `{field, value, sourceSpan: {start, end}}` for verifiable fields and `sourceSpan: null` for unverifiable ones.
