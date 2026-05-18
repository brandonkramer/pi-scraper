# `auto` mode

Starts with cheapest mode (`fast`) and escalates on failure signals.

## Escalation chain

1. `fast` — if 403/empty shell →
2. `readable` — if still blocked →
3. `fingerprint` — if still blocked →
4. `browser`

Stops at the first mode that returns usable content.

## Signal detection

- **403 / empty HTML shell** → escalates from fast to fingerprint
- **Data islands** → detects JSON-LD, `<script type="application/json">` content
- **PDF responses** → switches to PDF handling

## Examples

```
# Let pi-scraper figure out the best mode
web_scrape url="https://example.com" mode=auto
```

## Caveats

- May take longer as it tries multiple modes sequentially
- For known-bot-protected sites, specify `fingerprint` directly for faster results
- For known SPAs, specify `browser` directly
