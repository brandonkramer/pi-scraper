# pi-scraper Eval Corpus

This dev-only directory tracks extraction-quality coverage for release checks. It is intentionally outside the npm `files` allowlist.

Start with `corpus.json`, which describes representative cases for:

- static articles
- documentation pages
- product pages
- SPAs with data islands
- bot-block pages
- PDFs
- noisy marketing pages
- larger docs pages with tables, code blocks, links, and JSON data islands
- larger sparse SPA shells with hydration payloads

Future eval runners should keep robots/politeness enabled by default, avoid private-network targets, and record speed, byte counts, approximate token counts, extraction quality, and false-positive noise recovery notes.
