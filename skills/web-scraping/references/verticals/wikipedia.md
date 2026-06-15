# Wikipedia vertical extractor

**Action:** `wikipedia`

**Matches:** `https://en.wikipedia.org/wiki/:title`, `https://:lang.wikipedia.org/wiki/:title`

### Examples

```
# Standard article
web_extract action=vertical extractor=wikipedia url="https://en.wikipedia.org/wiki/TypeScript"

# Non-English Wikipedia
web_extract action=vertical extractor=wikipedia url="https://de.wikipedia.org/wiki/TypeScript"

# Short article
web_extract action=vertical extractor=wikipedia url="https://en.wikipedia.org/wiki/HTTP_cookie"
```

**Returns:** lang, title, description, extract (page summary text), pageUrl, thumbnail, revision, timestamp, wikibaseItem, sections[], images[], references[]

### Notes

- Uses the MediaWiki REST API (`/api/rest_v1/page/summary/:title`) plus action API calls for sections, images, and references
- `lang` defaults to `en` for bare `en.wikipedia.org` URLs
- `extract` is the article summary text (first few paragraphs)
- `sections` is a compacted array of `{level, line, number, anchor}` objects
- `images` is a compacted array of `{title, url, width, height, originalUrl}` objects
- `references` is an array of external link URLs
- `thumbnail` is the page thumbnail image URL (may be absent on pages without images)

## Instead of

If you're tempted to reach for:
- `wikipedia` Python package (extra pip install, Python dep)
- `curl -s "https://en.wikipedia.org/w/api.php?action=query&..."` (manual API calls, XML/JSON parsing, field extraction)
- HTML scraping the rendered page (fragile selectors, heavy payload)

**Stop.** This vertical calls the official MediaWiki APIs server-side, aggregates summary/sections/images/references, and returns structured data in one call. No extra packages, no HTML parsing.

## Browser fallback

Default to API path; browser mode is not typically needed for Wikipedia. Add `mode=browser` only if JS-rendered state, bot mitigation, or a logged-in session is required.
