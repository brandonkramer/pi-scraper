# `fingerprint` mode

Emulates Chrome or Firefox TLS handshake to bypass TLS-level bot detection.

## When to use

Sites that return 403, Cloudflare challenge, or empty HTML shell in `fast` mode.

```
# Site returned 403 or empty shell with fast mode
web_scrape url="https://bot-protected.example" mode=fingerprint

# Site known to use Cloudflare
web_scrape url="https://example.com" mode=fingerprint

# Crawling a bot-protected site
web_crawl url="https://example.com" maxPages=10 mode=fingerprint
```

## Browser profile

Defaults to Chrome. Firefox also available:

```
web_scrape url="https://example.com" mode=fingerprint browserProfile=firefox
```

## Session cookies

`sessionId`, `saveSession`, `clearSession` work identically across `fast` and `fingerprint` modes. Cookies set during a `fast` fetch are sent on a subsequent `fingerprint` fetch with the same `sessionId`, and vice versa:

```
# Step 1: accept consent cookies
web_scrape url="https://example.com/consent" mode=fingerprint sessionId="my-site" saveSession=true

# Step 2: scrape behind consent (same session, cookies persist)
web_scrape url="https://example.com/dashboard" mode=fingerprint sessionId="my-site"
```

## Limitations

- No JS execution — SPAs still need `browser` mode
- Uses pi-scraper's own session store for cookies, not impit's native jar (consistent with `fast` path)
- DNS rebinding mitigation is applied per-hop
