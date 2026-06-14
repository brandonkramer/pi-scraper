# 🕸️ pi-scraper

*A scraper-first, Pi-native, and local-first extension for the Pi ecosystem.*

---

[![NPM Version](https://img.shields.io/npm/v/pi-scraper?color=blue&style=flat-square)](https://www.npmjs.com/package/pi-scraper)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)
[![Pi Compatibility](https://img.shields.io/badge/pi-%3E%3D0.74.0-purple?style=flat-square)](https://github.com/earendil-works/pi-agent)

`pi-scraper` reads known URLs and sites. Use it to scrape, summarize one page, crawl, map URLs, diff snapshots, retrieve stored results, or download/extract deterministic/structured data — including CloakBrowser-backed browser mode with C++ fingerprint patches and persistent sessions.

---

## Quick Start

Install the extension via the Pi CLI:

```bash
pi install npm:pi-scraper
```

### Try these prompts:
Ask naturally; Pi can choose the right web tool automatically:

> [!TIP]
> - "Read **https://example.com** as markdown."
> - "List all URLs available from **https://example.com**."
> - "Crawl **https://example.com**, up to 25 pages."
> - "Compare **https://example.com** against my homepage snapshot."
> - "Open **https://example.com/login** in browser mode, save the session, then scrape **/dashboard**."

---

## ⚡ Scrape Modes

`pi-scraper` intelligently escalates its scraping strategy to balance speed and capability.

| Mode | JS Support | Speed | Best Use Case |
| :--- | :---: | :---: | :--- |
| **`fast`** | ❌ | 🚀 | Static HTML, documentation, and quick text extraction. |
| **`fingerprint`**| ❌ | 🏎️ | Sites that block simple bots (uses TLS fingerprinting). |
| **`readable`** | ❌ | ⏱️ | Articles and blogs where noise reduction is critical. |
| **`browser`** | ✅ | 🐢 | Heavily JS-rendered sites (uses CloakBrowser by default). |
| **`auto`** | 🤖 | 🔄 | **Default.** Automatically selects the best path based on signals. |

---

## 🛠️ Public Tools

| Tool | Capability | Best For... | Contract ≈ |
| :--- | :--- | :--- | :---: |
| `web_scrape` | 🏠 Local | Reading a single URL as Markdown, Text, or HTML. | 268 tokens |
| `web_crawl` | 🕷️ Resumable | BFS crawling to build local datasets or context packages. | 179 tokens |
| `web_map` | 🗺️ Discovery | Inventorying URLs via robots.txt, sitemaps, and llms.txt. | 51 tokens |
| `web_batch` | 📦 Bulk | Scaping multiple independent URLs concurrently. | 151 tokens |
| `web_extract` | 🔍 Structured | Deterministic, selector-based, or LLM-backed extraction. | 407 tokens |
| `web_get_result` | 📂 Retrieval | Accessing stored results, job manifests, or snapshots. | 55 tokens |

> [!NOTE]
> **Contract** is the total tokens for the tool declaration.

---

## 📖 Parameter Reference

| Area | Parameters | Description |
| :--- | :--- | :--- |
| **Shared** | `sessionId`, `saveSession`, `clearSession`, `stealth`, `autoWait`, `browserBackend`, `proxy`, `headers`, `provider` | Sessions, browser controls, and LLM provider selection. |
| **Scrape** | `url`, `urls`, `mode`, `format`, `refresh`, `respectRobots`, `timeoutSeconds` | Targets and fetch behavior. Summarize moved to `web_extract action=summarize`. |
| **Limits** | `maxBytes`, `maxChars`, `onlyMainContent` | Size limits and content cleaning. |
| **RAG chunks** | `chunks`, `maxTokens`, `overlapTokens` | `chunks=true` returns paragraph-bounded `chunks[]` alongside full markdown. |
| **Filtering** | `include`, `exclude`, `linesMatching`, `contextLines`, `caseSensitive` | Glob patterns and line-based content filtering. |
| **Redirection**| `followAlternates`, `followMetaRefresh` | Controls for non-standard redirects. |
| **Snapshots** | `snapshotName`, `snapshotTag`, `diff`, `compareTag`, `maxSnapshotAgeSeconds` | Versioning and diffing baselines. |
| **Crawl** | `action`, `maxPages`, `maxDepth`, `sameOrigin`, `concurrency`, `resume`, `crawlId`, `compile`, `seed`, `seedSitemap`, `status`, `limit`, `extract`, `strategy` | BFS/DFS/best-first discovery, limits, and state management. Strategy shown in progress output. |
| **Extract** | `action`, `extractor`, `prompt`, `schema`, `selector`, `selectorType`, `attribute`, `adaptive`, `bullets`, `sentences`, `identifier`, `autoSave`, `threshold`, `extractSchema` | Vertical, ad-hoc (with `grounded[]` source spans), selector, and summarize (`action=summarize`, `sentences`/`bullets`) extraction. |
| **Patterns** | `markers`, `contains`, `excerpts`, `regexes`, `sections`, `jsonPaths`, `sourceFormat`, `length` | Deterministic inspection: strings, regex, and ranges. |
| **Strategy Extraction** | `selectors` (field→selector map), `query`, `topN`, `minScore`, `flags` | New: css-extract, xpath-extract, regex-extract, cosine |
| **Proxy** | `proxy`; `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY`; `NO_PROXY` | Explicit proxy URL, proxy arrays for crawl rotation, or env-var auto-config when `proxy` is omitted. |
| **Map** | `url`, `maxSitemaps` | Site-wide discovery of robots.txt and sitemaps. |
| **Storage** | `saveToFile` | `true` or `{dir, filename, maxBytes}` for disk storage. |
| **Retrieval** | `responseId`, `jobId`, `snapshotUrl`, `snapshotName`, `snapshotTag` | Retrieve stored payloads and job manifests. |

---

## 🔑 Sessions & Persistence

`pi-scraper` is stateless by default. Use `sessionId` when you need to maintain state (cookies, login, cart) across multiple calls.

- **`sessionId`**: A unique key for the session.
- **`saveSession`**: Persist cookies to disk (useful across Pi reloads).
- **`clearSession`**: Wipe the session state.
- **`fingerprint`**: Use `mode: "fingerprint"` to bypass basic bot blocks using browser-grade TLS fingerprints without the overhead of a full browser.

```text
// Example: Log in and then scrape a protected page
web_scrape({ url: "https://example.com/login", sessionId: "user-1", saveSession: true })
web_scrape({ url: "https://example.com/dashboard", sessionId: "user-1" })
```

---

## 🛡️ Proxy Configuration

`pi-scraper` can route requests through explicit proxy URLs or standard proxy environment variables. SSRF protection still runs before network I/O and on redirects; SOCKS target hostnames are resolved locally before CONNECT so private/reserved addresses can still be blocked.

### Explicit `proxy`

Pass `proxy` when you want a specific route for a call:

```text
web_scrape({
  url: "https://example.com",
  proxy: "http://proxy.example:8080"
})
```

Supported proxy URL schemes for static fetch modes (`fast` and `readable`):

- `http://` and `https://` HTTP proxy URLs.
- `socks5://` and `socks://` SOCKS5 proxy URLs.
- `socks4://` SOCKS4 proxy URLs. SOCKS4 requires an IPv4 DNS result for the target.

`pi-scraper` intentionally rejects `socks5h://` and `socks4a://`: those schemes require proxy-side DNS, which would bypass local DNS/SSRF validation.

`mode: "fingerprint"` can use HTTP(S) proxies. SOCKS proxies are accepted only for literal-IP targets; hostname targets fail closed with guidance to use `fast`/`readable` or an HTTP(S) proxy.

### Env-var proxy auto-config

When `proxy` is omitted, `pi-scraper` automatically checks standard environment variables:

- `https://` targets: `HTTPS_PROXY` → `https_proxy` → `ALL_PROXY` → `all_proxy`.
- `http://` targets: `HTTP_PROXY` → `http_proxy` → `ALL_PROXY` → `all_proxy`.

`NO_PROXY` / `no_proxy` bypasses env-derived proxies. It supports `*`, comma-separated host rules, domains and subdomains (`example.com`, `.example.com`), `host:port` including default ports, and IPv6 hosts with or without brackets.

```bash
HTTPS_PROXY=http://127.0.0.1:8080 \
NO_PROXY=localhost,127.0.0.1,.internal.example \
pi
```

An explicit `proxy` parameter always wins over env vars.

### Per-page crawl proxy rotation

`web_crawl` accepts a proxy array and resolves a proxy before each page scrape. For example, five pages with `proxy: ["a", "b", "c"]` use `a, b, c, a, b`.

```text
web_crawl({
  url: "https://docs.example.com",
  maxPages: 25,
  proxy: [
    "http://proxy-us.example:8080",
    "socks5://127.0.0.1:9050"
  ]
})
```

Single-string `proxy` keeps one proxy for the crawl. Omitting `proxy` uses env-var auto-config when available, otherwise direct fetches.

---

## 🎯 Selector Extraction

Extract structured data using CSS selectors, XPath, or plain text search.

| Parameter | Description |
| :--- | :--- |
| **`selector`** | The CSS/XPath/Text to find. |
| **`attribute`** | Extract a specific attribute (e.g., `href`) instead of text. |
| **`adaptive`** | Enable relocation if the page layout changes. Fingerprint-based first, then text-anchor healing. |
| **`limit`** | Maximum elements to return. |

### Example:
```json
{
  "url": "https://example.com/products",
  "selector": ".product-card",
  "identifier": "products-v1",
  "autoSave": true,
  "limit": 5
}
```

---

## 🤖 Adhoc LLM Extraction (Source-Grounded)

`web_extract action=adhoc` uses a model adapter to extract structured data from page text. After the LLM responds, pi-scraper post-processes the output to locate each extracted string in the cleaned source text.

**Result shape:**
```json
{
  "data": { "title": "Super Widget", "price": "$19.99" },
  "grounded": [
    { "field": "title", "value": "Super Widget", "sourceSpan": { "start": 23, "end": 35 } },
    { "field": "price", "value": "$19.99", "sourceSpan": { "start": 43, "end": 49 } }
  ]
}
```

- **`sourceSpan`** — character offsets into the cleaned text the LLM consumed (exact, case-insensitive, or whitespace-collapsed match).
- **`sourceSpan: null`** — value could not be verified in source (not a failure; field is still returned).
- Tool summary shows `(verified/total fields source-grounded)`.

### 🤖 Peer-Optional Fallback Model Adapter
For `web_extract action=summarize` or `action=adhoc` when no explicit adapter is provided:
- Seamlessly falls back to the user's locally-configured Pi model (OpenAI, Anthropic, Gemini, Bedrock, etc.) if no registered adapter is available.
- Uses lazy dynamic imports of `@earendil-works/pi-ai` for a **zero install footprint** for users who only use deterministic scraping and crawling.
- Also participates in the cross-extension `pi:model-adapter/*` event protocol so provider extensions can lend their LLM transport.

---

## 🕷️ Resumable & Deep Web Crawling

`web_crawl` is an high-concurrency crawler that supports pausing, resuming, and multiple path traversal strategies to build local datasets or context packages.

### 🧭 Crawl Strategies
Configure how the crawler discovers and explores links using the `strategy` parameter:
- **`bfs` (Breadth-First Search - Default)**: Explores level-by-level (all links at depth 1, then depth 2, etc.). Best for general site scanning and sitemap building.
- **`dfs` (Depth-First Search)**: Explores deep into a single branch (e.g., following nested subdirectories or article links) before backtracking. Perfect for systematically drilling down nested document files.
- **`best-first`**: Sorts and prioritizes links dynamically based on structural indicators (giving priority to documentation indexes, category pages, and main article hubs).
- **TUI Progress Feedback**: The live crawler progress bar and terminal TUI cards dynamically render the active strategy so you can monitor traversals.

---

## 🌐 Browser Mode Support

`mode: "browser"` uses **CloakBrowser** by default — a patched Chromium binary with 48 C++-level fingerprint patches.

### ⚙️ Backend options

| Backend | Default | Browser | Stealth level | Requirement |
|---------|----------|---------|---------------|-------------|
| `"cloak"` | ✅ | CloakBrowser Chromium 145 | C++ source-level (48 patches) | Bundled |
| `"playwright"` | ❌ | Stock Playwright Chromium | JS `page.evaluate()` via `stealth=true` | `npm install playwright` |

### 🛡️ Fingerprint evasion

CloakBrowser does not need `stealth=true` — all anti-detection patches (navigator.webdriver, canvas, WebGL, audio, fonts, GPU, screen, WebRTC, network timing) are applied at the **C++ binary level**, undetectable by any JS-level bot detection.

Test results from CloakBrowser:
- reCAPTCHA v3 score: **0.9** (human)
- Cloudflare Turnstile: **PASS**
- FingerprintJS: **PASS**
- BrowserScan: **NORMAL** (4/4)
- 30+ detection sites: **passed**

### 💾 Persistent sessions (CloakBrowser only)

When using CloakBrowser with `sessionId` + `saveSession=true`:

```
web_scrape url="https://example.com" mode=browser sessionId="my-session" saveSession=true
```

CloakBrowser uses **`launchPersistentContext()`** which writes cookies, localStorage, and session state to a disk profile at `~/.pi/browser-sessions/<sessionId>/`. This:
- Avoids incognito/private-mode detection (BrowserScan penalizes incognito by ~10%)
- Survives Pi restarts and process reloads
- Keeps login state across multiple scrape calls

To persist an authenticated login flow:

1. **Log in and Save the Session**
   Open the login page in browser mode. Specifying `saveSession=true` writes the cookies and session state to your local profile.
   ```bash
   web_scrape url="https://example.com/login" mode=browser sessionId="site-session" saveSession=true
   ```

2. **Scrape Authenticated Content**
   Subsequent calls using the same `sessionId` automatically inherit the authenticated state (cookies, local storage, etc.).
   ```bash
   web_scrape url="https://example.com/dashboard" mode=browser sessionId="site-session"
   ```

3. **Clear the Session when Done (Optional)**
   Wipe the saved session and context from your local disk.
   ```bash
   web_scrape url="https://example.com" mode=browser sessionId="site-session" clearSession=true
   ```

### 🔧 CloakBrowser-specific options

| Option | Type | Description |
|--------|------|-------------|
| `timezone` | string | IANA timezone (e.g. `"America/New_York"`). Set via binary flag — undetectable. |
| `locale` | string | BCP 47 locale (e.g. `"en-US"`). Set via `--lang` binary flag. |
| `proxy` | string | Browser backend proxy URL. Static fetch proxy schemes and env-var behavior are documented in the Proxy Configuration section above. |

These are safe to set even with the Playwright backend (ignored or applied via JS patches).

---

## 🏗️ Vertical Extraction

For well-known sites, `pi-scraper` uses optimized "vertical" extractors that hit APIs directly, bypassing slow HTML scraping.

| Vertical | Platforms / Sites | Extracted Data / Possibilities |
| :--- | :--- | :--- |
| **GitHub Repo** | GitHub | Metadata, README, File Tree, Languages, Topics. |
| **GitHub Issue** | GitHub | Issue body, comments, participants, labels, status. |
| **GitHub PR** | GitHub | Pull request body, diff stats, reviews, comments. |
| **GitHub Release** | GitHub | Release notes, tag info, assets, author metadata. |
| **GitIngest** | GitHub / gitingest.com | Prompt-friendly codebase digest, directory structure, and full-content download URL. |
| **npm Package** | npmjs.com | Manifest JSON, versions, dependencies, README. |
| **PyPI Package** | pypi.org | Package metadata, versions, author, description. |
| **crates.io** | crates.io | Rust crate metadata, versions, dependencies. |
| **Docker Hub** | hub.docker.com | Image metadata, tags, architectures, layers. |
| **HF Model** | huggingface.co | Model cards, metadata, files, community stats. |
| **HF Dataset** | huggingface.co | Dataset cards, configuration, metadata, previews. |
| **Hacker News** | ycombinator.com | Story/Comment trees via Firebase API. |
| **arXiv** | arxiv.org | Academic paper metadata and Atom feeds. |
| **DeepWiki** | deepwiki.io | Structured wiki content and metadata. |
| **Docs Site** | Docusaurus, RTD | Sections, sidebar navigation, and page metadata. |
| **docstrings** | TS/JS/Py/Rs | Exported symbols, types, and function signatures. |
| **Youtube Metadata** | youtube.com | Video title, views, channel name, duration, and description. |
| **Youtube Transcriptions** | youtube.com | **Full transcripts** in plain-text and timed segments. |
| **Youtube Comments** | youtube.com | Preview of top video comments and engagement stats. |
| **Reddit Post** | reddit.com | Post content, scoring, flairs, and author metadata. |
| **Reddit Thread** | reddit.com | **Full nested comment trees** (retains original thread depth). |
| **Reddit List** | reddit.com | Subreddit listings (hot/new/top) and search results. |
| **OSS Analytics** | ossinsight.io | Real-time repository metrics, stars, and contribution trends. |
| **OSS Trending** | ossinsight.io | Daily/weekly trending repositories and collections. |
| **OSS Rankings** | ossinsight.io | Collection-based rankings and ecosystem comparison data. |

```text
// Get structured data for an npm package
web_extract({ action: "vertical", url: "https://www.npmjs.com/package/undici" })

// Get YouTube video metadata, transcript, and comment preview
web_extract({ action: "vertical", extractor: "youtube", url: "https://www.youtube.com/watch?v=arj7oStGLkU" })
```

### 🧰 YAML manifests, overrides, and custom verticals

Most verticals are backed by declarative YAML manifests in `verticals/*.yaml`. You can extend or override them without changing the public tool API: keep calling `web_extract({ action: "vertical", ... })`.

Manifest load order is layered:

1. Built-ins: package `verticals/*.yaml`
2. User overrides/additions: `~/.pi/scraper/verticals/*.{yaml,yml,json,jsonc}`
3. Project overrides/additions: `.pi/scraper/verticals/*.{yaml,yml,json,jsonc}`

A user or project manifest with the same `name` replaces the lower-priority manifest; a new `name` adds a new vertical. Run `web_extract({ action: "list" })` to see each vertical's source, whether it is declarative, and whether it overrides another manifest.

See the bundled [`verticals/`](verticals/) folder for examples.

Minimal custom vertical example:

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

Supported manifest styles include `api-json`, `api-json-aggregate`, `api-json-chain`, `http-workflow`, `api-xml`, `selector`, `pattern`, `html-extract`, `text-extract`, `code-extract`, and bounded `recipe` primitives.

If you are asking an LLM/agent to create or override one, use this prompt:

> Use the `pi-scraper` `web-scraping` skill's custom vertical manifest reference to create a YAML vertical for this site. Choose the right manifest style, place it in the correct project or user verticals folder, and verify it with `web_extract`.

---

## 💾 Download, Storage & History

Large results are stored automatically. You can retrieve them later using `web_get_result`.

### 📂 Persistent Paths
| Data | Path |
| :--- | :--- |
| **SQLite Index** | `~/.pi/scraper/index.db` |
| **Payload Blobs** | `~/.pi/scraper/blobs/` |
| **Downloads** | `~/.pi/scraper/downloads/` |

### 📄 Binary Downloads
Add `saveToFile: true` to persist PDFs, images, or archives to disk.
```json
{ "url": "https://arxiv.org/pdf/1706.03762", "saveToFile": true }
```

### ⚖️ Max Bytes
Control the fetch limit per request (default: **30 MB**).
```json
{ "url": "https://example.com/large.zip", "maxBytes": 104857600 }
```

---

## 🗺️ Site Mapping (`web_map`)

Use `web_map` for fast discovery of a domain's structure without downloading full page bodies. It is an "inventory-only" tool.

**What it discovers:**
- **`robots.txt`**: Respects crawl delays and discovers sitemap links.
- **Sitemaps**: Automatically parses `sitemap.xml` and gzipped sitemaps.
- **`llms.txt`**: Finds specialized manifests designed for AI consumption.

```json
// Inventory all known URLs for a domain
{ "url": "https://example.com", "action": "inventory" }
```

---

## 🔒 Safety & Resilience

- **SSRF Protection:** Built-in validation at the connect and redirect layers.
- **Robots.txt:** Full respect for site crawling rules (configurable).
- **Memory Efficient:** Large responses are streamed and stored locally.
- **Incremental Enforcement:** `maxBytes` limits are enforced during the stream.

---

## ⚙️ Configuration

Use the `/scrape-config` slash command to manage your settings interactively or via the CLI:

```bash
/scrape-config status                     # View current settings
/scrape-config scrape-mode browser        # Set default mode to browser
/scrape-config robots off                 # Disable robots.txt respect
/scrape-config cache clear                # Wipe the local response cache
```

---

## 📦 Developer Info

If you are contributing to or building on top of `pi-scraper`:

### Requirements
- **Node.js**: `>=22.19.0`
- **Pi**: `>=0.74.0`

### Build & Test
```bash
npm install        # Install dependencies
npm run typecheck  # Verify types
npm test           # Run unit tests
npm run test:tools # Run tool smoke tests
```

### 🔄 Playwright backend (opt-out)

To use stock Playwright Chromium instead of CloakBrowser:
```bash
npm install playwright
npx playwright install chromium
```

```
web_scrape url="https://example.com" mode=browser browserBackend=playwright stealth=true
```

---

## 📜 License

This project is licensed under the **MIT License**. See [LICENSE](LICENSE) for details.
