# 🕸️ pi-scraper

**Crawl, map, and extract with precision.**  
*A scraper-first, Pi-native, and local-first extension for the Pi ecosystem.*

---

[![NPM Version](https://img.shields.io/npm/v/pi-scraper?color=blue&style=flat-square)](https://www.npmjs.com/package/pi-scraper)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)
[![Pi Compatibility](https://img.shields.io/badge/pi-%3E%3D0.74.0-purple?style=flat-square)](https://github.com/earendil-works/pi-agent)

`pi-scraper` reads known URLs and sites. Use it to scrape, summarize one page, crawl, map URLs, diff snapshots, retrieve stored results, or download/extract deterministic/structured data.

---

## 🚀 Quick Start

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

---

## ⚡ Scrape Modes

`pi-scraper` intelligently escalates its scraping strategy to balance speed and capability.

| Mode | JS Support | Speed | Best Use Case |
| :--- | :---: | :---: | :--- |
| **`fast`** | ❌ | 🚀 | Static HTML, documentation, and quick text extraction. |
| **`fingerprint`**| ❌ | 🏎️ | Sites that block simple bots (uses TLS fingerprinting). |
| **`readable`** | ❌ | ⏱️ | Articles and blogs where noise reduction is critical. |
| **`browser`** | ✅ | 🐢 | Heavily JS-rendered sites (requires Playwright). |
| **`auto`** | 🤖 | 🔄 | **Default.** Automatically selects the best path based on signals. |

---

## 🛠️ Public Tools

| Tool | Capability | Best For... | Contract ≈ | Input + |
| :--- | :--- | :--- | :---: | :---: |
| `web_scrape` | 🏠 Local | Reading a single URL as Markdown, Text, or HTML. | 233 | +244 |
| `web_crawl` | 🕷️ Resumable | BFS crawling to build local datasets or context packages. | 158 | +175 |
| `web_map` | 🗺️ Discovery | Inventorying URLs via robots.txt, sitemaps, and llms.txt. | 58 | +65 |
| `web_batch` | 📦 Bulk | Scaping multiple independent URLs concurrently. | 177 | +176 |
| `web_extract` | 🔍 Structured | Deterministic, selector-based, or LLM-backed extraction. | 246 | +265 |
| `web_get_result` | 📂 Retrieval | Accessing stored results, job manifests, or snapshots. | 56 | +114 |

> [!NOTE]
> **Contract** is the total tokens for the tool declaration. **Input +** is the typical token overhead when Pi calls the tool.

---

## 📖 Parameter Reference

| Area | Parameters | Description |
| :--- | :--- | :--- |
| **Shared** | `sessionId`, `saveSession`, `clearSession`, `stealth`, `autoWait`, `proxy`, `headers`, `provider` | Sessions, browser controls, and LLM provider selection. |
| **Scrape** | `url`, `urls`, `content`, `task`, `mode`, `format`, `refresh`, `respectRobots`, `timeoutSeconds` | Targets, tasks (`read`/`summarize`), and fetch behavior. |
| **Limits** | `maxBytes`, `maxChars`, `onlyMainContent` | Size limits and content cleaning. |
| **Filtering** | `include`, `exclude`, `linesMatching`, `contextLines`, `caseSensitive` | Glob patterns and line-based content filtering. |
| **Redirection**| `followAlternates`, `followMetaRefresh` | Controls for non-standard redirects. |
| **Snapshots** | `snapshotName`, `snapshotTag`, `diff`, `compareTag`, `maxSnapshotAgeSeconds` | Versioning and diffing baselines. |
| **Crawl** | `action`, `maxPages`, `maxDepth`, `sameOrigin`, `concurrency`, `resume`, `crawlId`, `compile`, `seed`, `seedSitemap`, `status`, `limit`, `extract` | BFS discovery, limits, and state management. |
| **Extract** | `action`, `extractor`, `prompt`, `schema`, `selector`, `selectorType`, `attribute`, `adaptive`, `bullets`, `sentences`, `identifier`, `autoSave`, `threshold`, `extractSchema` | Vertical, ad-hoc, and selector extraction. |
| **Patterns** | `markers`, `contains`, `excerpts`, `regexes`, `sections`, `jsonPaths`, `sourceFormat`, `length` | Deterministic inspection: strings, regex, and ranges. |
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

## 🎯 Selector Extraction

Extract structured data using CSS selectors, XPath, or plain text search.

| Parameter | Description |
| :--- | :--- |
| **`selector`** | The CSS/XPath/Text to find. |
| **`attribute`** | Extract a specific attribute (e.g., `href`) instead of text. |
| **`adaptive`** | Enable relocation if the page layout changes. |
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

## 🏗️ Vertical Extraction

For well-known sites, `pi-scraper` uses optimized "vertical" extractors that hit APIs directly, bypassing slow HTML scraping.

| Vertical | Platforms / Sites | Extracted Data / Possibilities |
| :--- | :--- | :--- |
| **GitHub Repo** | GitHub | Metadata, README, File Tree, Languages, Topics. |
| **GitHub Issue** | GitHub | Issue body, comments, participants, labels, status. |
| **GitHub PR** | GitHub | Pull request body, diff stats, reviews, comments. |
| **GitHub Release** | GitHub | Release notes, tag info, assets, author metadata. |
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

### Optional Browser Support
If you need `mode: "browser"`, install the Chromium binaries:
```bash
npx playwright install chromium
```

---

## 📜 License

This project is licensed under the **MIT License**. See [LICENSE](LICENSE) for details.
