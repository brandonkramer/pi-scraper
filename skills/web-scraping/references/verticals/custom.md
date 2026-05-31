# Custom vertical manifests

Create project or user YAML/JSON manifests when a known-site vertical is missing or needs a local override. This keeps the same public tool API:

```text
web_extract action=vertical extractor=<name> url=<url>
```

Use this when the target has stable URL patterns and structured HTML/text/API responses. Prefer a declarative manifest over ad-hoc shell/HTTP pipelines.

## Where to put manifests

| Scope | Path | Use for |
|-------|------|---------|
| Project | `.pi/scraper/verticals/<name>.yaml` | Repo-specific extractors or overrides checked into a project. |
| User | `~/.pi/scraper/verticals/<name>.yaml` | Personal extractors or overrides available across projects. |
| Built-in examples | package `verticals/*.yaml` | Complete examples bundled with `pi-scraper`. |

Load precedence:

1. Built-in package manifests
2. User manifests
3. Project manifests

A manifest with the same `name` as a lower-priority manifest overrides it. A manifest with a new `name` adds a new vertical.

## Minimal manifest

```yaml
version: 1
name: my_docs
kind: api-json
description: Example docs metadata from a JSON endpoint.
urlPatterns:
  - https://docs.example.com/:slug+
request:
  urlTemplate: https://docs.example.com/api/pages/{{slug|encodePathSegments}}
extract:
  title: $.title
  updatedAt: $.updated_at
  summary: $.summary
```

## Top-level fields

| Field | Purpose |
|-------|---------|
| `version` | Manifest format version. Use `1`. |
| `name` | Extractor name. Use stable snake_case/kebab-case starting with a letter. |
| `kind` | Runtime style; see supported kinds below. |
| `description` | Short routing/display description. |
| `urlPatterns` | Input URL patterns that activate the vertical. |
| `order` | Optional match/display order within a layer; lower runs first. |
| `request` | Single HTTP request definition. |
| `requests` | Parallel named HTTP requests for aggregate manifests. |
| `steps` | Sequential chain/workflow steps. |
| `matchOptions` | Defaults, exclusions, and query captures for URL matching. |
| `extract` | Field projection map for scalar/object output. |
| `extractList` | Array/list projection from a response. |
| `extractListWrapper` | Scalar wrapper fields around list output. |
| `fields` | Rule-driven extraction for HTML/text/JSON recipes. |
| `clean` | Text cleanup rules for rule-driven extraction. |
| `limits` | Per-field max character truncation. |
| `preview` | Which field to show in compact output. |
| `requirements` | Metadata flags: browser, LLM, cloud. |
| `capabilities` | Display facets for `web_extract action=list`. |
| `options` | Option metadata for built-in/runtime-specific manifests. |
| `outputSchema` | Optional JSON Schema-like output metadata. |

## Supported `kind` values

| Kind | Use for | Main fields |
|------|---------|-------------|
| `api-json` | One JSON request then field projection. | `request`, `extract` or `extractList` |
| `api-json-aggregate` | Parallel JSON requests merged into one scope. | `requests`, `extract` |
| `api-json-chain` | Sequential JSON requests where later steps use earlier values. | `steps`, `extract` |
| `http-workflow` | More complex bounded HTTP workflows. | `steps`, `extract`/workflow fields |
| `api-xml` | XML/Atom/RSS-like responses. | `request`, `extract` with `xml:` selectors |
| `selector` | Simple HTML selector extraction. | `request`, `extract` |
| `pattern` | Regex extraction from fetched text. | `request`, `extract` |
| `html-extract` | Rule-driven extraction from HTML pages. | `request`, `fields`, `clean` |
| `text-extract` | Rule-driven extraction from text responses. | `request`, `fields`, `clean` |
| `code-extract` | Source-file docstring/API surface extraction. | `languages`, `extensions`, limits |
| `recipe` | Bounded named primitives for shared runtime behaviors. | `recipe` |

`builtin` is reserved for package-owned TypeScript extractors; do not use it for project/user manifests.

## URL matching and captures

`urlPatterns` capture path variables for templates and extraction.

```yaml
urlPatterns:
  - https://example.com/packages/:name/v/:version
  - https://example.com/packages/:name
```

Common pattern forms:

- `:name` captures one path segment.
- `:name+` captures one or more path segments, useful for scoped packages such as `@scope/name`.
- Captures are available as `{{name}}`, `{{version}}`, etc.
- `{{url}}` expands to the input URL.

### `matchOptions`

```yaml
matchOptions:
  defaults:
    version: latest
  exclude:
    name: [search, login]
  query:
    lang:
      from: lang
      default: en
      enum: [en, es, fr]
```

Use `matchOptions` to:

- set default capture values,
- reject specific captured values,
- capture/validate query parameters.

## Request options

`request` and each item in `requests`/`steps[].request` can use:

```yaml
request:
  method: GET
  urlTemplate: https://api.example.com/{{name|encodeURIComponent}}
  queryPassthrough: [page, sort]
  queryParams:
    version: "{{version|default:latest|encodeURIComponent}}"
  headers:
    accept: application/json
  bodyTemplate: '{"query":"{{name}}"}'
```

Supported request fields:

- `method`: `GET`, `POST`, `PUT`, or `DELETE`; defaults to `GET`.
- `urlTemplate`: required URL template.
- `queryPassthrough`: copies selected query params from the input URL.
- `queryParams`: adds template-expanded query params.
- `headers`: request headers.
- `bodyTemplate`: template-expanded request body for non-GET/custom requests.

Template filters:

- `encodeURIComponent`
- `encodePathSegments`
- `default:<value>`
- `switch:a=b,c=d,*=fallback-{value}`

## JSON/XML projection with `extract`

For `api-json`, map output field names to JSONPath-like selectors, capture templates, or constants:

```yaml
extract:
  name: $.name
  owner: "{{owner}}"
  stars: $.stargazers_count|number
  readmePreview: $.readme|clean|truncate:1000
  repoUrl: https://github.com/{{owner}}/{{repo}}
```

Expression features:

- `$.path.to.value` reads JSON fields.
- `{{capture}}` expands URL/query captures.
- `a || b || c` returns the first non-empty value.
- String literals are returned as-is when not a selector/template.

Common transforms:

- `clean` — trim/decode/normalize text.
- `number` — coerce to number.
- `boolean` — coerce to boolean.
- `trueOnly` — keep only literal `true`.
- `length` — string length.
- `firstLine` — first non-empty line.
- `compact` — remove null/undefined from arrays.
- `emptyToUndefined` — omit empty strings.
- `truncate:<chars>` — truncate long strings.
- `isLongerThan:<chars>` — boolean-ish length check.
- `unlessCapture:<name>` — omit when a capture exists.
- `after:<marker>` — text after marker.
- `pluck:<path>` — map an array to one field.
- `map:<out>=<path>,...` — map array objects to projected objects.

For `api-xml`, use `xml:` selectors:

```yaml
extract:
  title: xml:first:feed>entry>title|clean
  links: xml:attrs:feed>entry>link@href
  pdf: xml:attr:feed>entry>link[title=pdf]@href
```

XML modes:

- `xml:first:path>to>tag`
- `xml:all:path>to>tag`
- `xml:attrs:path>to>tag@attr`
- `xml:attr:path>to>tag[predicate=value]@attr`

## List extraction

Use `extractList` when the response contains an array:

```yaml
extractList:
  path: $.items
  as: packages
  omitUndefined: true
  fields:
    name: $.name
    url: $.html_url
    stars: $.stars|number
extractListWrapper:
  total: $.total_count|number
```

- `path` selects the array.
- `as` names the output array field; defaults to `items`.
- `fields` maps each array item.
- `omitUndefined` drops missing fields.
- `extractListWrapper` adds scalar fields around the list.

## Parallel aggregate requests

Use `api-json-aggregate` when one vertical needs several independent API calls.

```yaml
kind: api-json-aggregate
requests:
  package:
    urlTemplate: https://registry.example.com/{{name}}
  downloads:
    optional: true
    fallback: { count: 0 }
    urlTemplate: https://registry.example.com/{{name}}/downloads
extract:
  name: @.package.name
  downloads: @.downloads.count|number
```

Aggregate request extras:

- `optional: true` allows a request to fail.
- `fallback` supplies a value if a request fails.
- Named request results are available in scope by request name.

## Sequential chains

Use `api-json-chain` when later requests depend on earlier responses.

```yaml
kind: api-json-chain
steps:
  - request:
      urlTemplate: https://api.example.com/search?q={{name|encodeURIComponent}}
    select: $.items
    find:
      where: $.name
      equals: "{{name}}"
      include: $.id
      errorMessage: Package not found
    as: packageId
  - request:
      urlTemplate: https://api.example.com/packages/{{packageId}}
    select: $
    as: package
extract:
  id: "{{packageId}}"
  title: @.package.title
```

Step features:

- `request` fetches JSON for the step.
- `select` reads a value from the step response.
- `as` stores the selected value in scope.
- `find` searches a selected array using `where`, `equals`, optional `include`, optional `transform`, and `errorMessage`.

## Rule-driven HTML/text/JSON extraction

Use `html-extract`, `text-extract`, or `recipe` primitives such as `html.extract`, `text.extract`, and `json.extract` for pages that are not simple JSON projections.

```yaml
kind: html-extract
request:
  urlTemplate: https://docs.example.com/{{slug|encodePathSegments}}
fields:
  title:
    selectorText: [h1, title]
  description:
    meta: [description, og:description]
  breadcrumbs:
    kind: breadcrumbs
  sections:
    kind: headingSections
```

Field rule possibilities include:

- literal `value`
- nested `object`
- JSON `path`
- `regex` with `flags`, `group`, and transforms
- token extraction with `tokens`
- section extraction with `sectionList`
- HTML `selectorText`
- HTML `meta`
- docsite helpers: `docsitePlatform`, `docsiteVersion`, `breadcrumbs`, `headingSections`, `mdnSignature`
- JSON walking rules via `collect` / `walkObjects`

`clean` can trim, strip tags, and collapse whitespace for text rules:

```yaml
clean:
  stripTags: true
  collapseWhitespace: true
  trim: true
```

## Code extraction

Use `code-extract` for raw source URLs.

```yaml
kind: code-extract
languages: [typescript, javascript, python, rust]
extensions: [.ts, .tsx, .js, .jsx, .py, .rs]
includePrivate: false
maxExamples: 2
maxExports: 100
```

## Requirements, capabilities, preview, and limits

```yaml
requirements:
  requiresBrowser: false
  requiresLLM: false
  requiresCloud: false
capabilities:
  - package_metadata
  - versions
preview:
  field: description
  firstLine: true
limits:
  readme:
    maxChars: 20000
```

Use these for better routing, display, and bounded output:

- `requirements` tells agents whether browser/LLM/cloud behavior is expected.
- `capabilities` appears in extractor listing/discovery.
- `preview` chooses compact output text.
- `limits` truncates large string fields.

## Errors and safety

- Manifest names must start with a letter and contain only letters, numbers, `_`, or `-`.
- `urlPatterns` and request URLs must be HTTP(S).
- Private-network URL templates are rejected.
- Invalid manifests appear as diagnostics and are not activated.
- Use bounded outputs (`limits`, `extractList`, selective `fields`) for large APIs.

## Verify changes

After creating or editing a manifest, run:

```text
web_extract action=list
```

Check the result for:

- `source` — `builtin`, `user`, or `project`
- `isDeclarative` — true for YAML/JSON manifest-backed verticals
- `overridden` — true when the active manifest replaces a lower-priority one
- `diagnostics` — validation warnings/errors, when present

Then test a URL:

```text
web_extract action=vertical extractor=my_docs url="https://docs.example.com/getting-started"
```

## Rules

- Use a project manifest for repo-specific behavior; use a user manifest only when you want the vertical available everywhere.
- Keep manifest names stable and snake_case/kebab-case, e.g. `my_docs`, `company-registry`.
- If overriding a built-in vertical, keep the same `name` and verify with `web_extract action=list` before relying on it.
- Prefer API JSON/XML manifests over browser mode when the data is available directly.
- Do not add CAPTCHA-solving or broad search/research behavior to vertical manifests.
