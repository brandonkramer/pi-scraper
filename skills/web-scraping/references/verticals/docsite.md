# Docsite vertical extractor

**Action:** `docsite`

Matches documentation sites across multiple platforms. Uses HTML parsing (not an API), so requires `fetchText` or `fetchPage` support.

### Supported platforms

- **Docusaurus** — detected via `html[data-theme]`, `.theme-doc-markdown`, `.navbar-sidebar`
- **ReadTheDocs** — detected via `.wy-nav-side`, `.rst-content`
- **GitBook** — detected via `[class*="gitbook"]`, `[data-testid="page.outline"]`
- **MDN** — detected via `developer.mozilla.org` hostname
- **Unknown** — falls back to generic heading extraction

### Examples

```
# Docusaurus docs
web_extract action=docsite url="https://docusaurus.io/docs/installation"

# ReadTheDocs
web_extract action=docsite url="https://requests.readthedocs.io/en/latest/"

# GitBook
web_extract action=docsite url="https://mister-remote.gitbook.io/mcp-server-list/"

# MDN
web_extract action=docsite url="https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API"

# Generic docs page
web_extract action=docsite url="https://example.com/docs/getting-started"

# API reference page
web_extract action=docsite url="https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/map"
```

**Returns:** platform, version, breadcrumbs[], title, summary, sections[{heading, content, subSections?}], apiSignature?, source

**API signature (MDN only):** name, signature, parameters[{name, type?, description?}], returns

### Notes

- MDN pages get extra `apiSignature` parsing with parameter extraction from `<dt>`/`<code>` elements
- Version detection is platform-specific: ReadTheDocs uses URL path segment, Docusaurus uses `/docs/` or `/api/` prefix
- Sections are extracted from `article`, `main`, `.theme-doc-markdown`, `.rst-content .document`, or `.markdown-section` with heading-based splitting (max 1200 chars per section)
- Breadcrumbs come from `nav[aria-label*=breadcrumb]` or `<nav>` elements

## Instead of

If you're tempted to reach for:
- `curl -s <docs-url> | grep -oP '<h[1-3]>.*?</h[1-3]>'` (manual heading scraping)
- Writing a custom script to extract sidebar nav / breadcrumbs / sections
- Manually detecting whether a site is Docusaurus, ReadTheDocs, GitBook, or MDN

**Stop.** This vertical auto-detects the docs platform (Docusaurus/ReadTheDocs/GitBook/MDN/generic), extracts breadcrumbs, sections with content, and API signatures — in one call. No platform detection code needed.

## Browser fallback

Default to this vertical's API/direct HTTP path; it is faster and more reliable than browser rendering. Add `mode=browser` only as an explicit fallback when JS-rendered page state, bot mitigation, or a logged-in CloakBrowser session is needed. In browser mode, pi-scraper pre-renders the page with CloakBrowser and passes that rendered page to the extractor's page-fetch path.
