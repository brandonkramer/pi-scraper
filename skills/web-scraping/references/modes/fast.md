# `fast` mode

Default for most sites. No special behavior.

```
web_scrape url="https://example.com"
```

**How:** Undici HTTP client + local HTML parsing (htmlparser2).

**When:** Default. Use unless the site blocks with 403/Cloudflare or requires JS rendering.

**Session cookies:** Supported via `sessionId`/`saveSession`/`clearSession`. Cookies are shared across `fast` and `fingerprint` modes — set in one, read in the other. See [fingerprint mode](fingerprint.md#session-cookies) for details and examples.
