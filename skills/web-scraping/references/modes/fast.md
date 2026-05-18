# `fast` mode

Default for most sites. No special behavior.

```
web_scrape url="https://example.com"
```

**How:** Undici HTTP client + local HTML parsing (htmlparser2).

**When:** Default. Use unless the site blocks with 403/Cloudflare or requires JS rendering.

**Session cookies:** Supported via `sessionId`/`saveSession`/`clearSession`. See [session reference](../session.md).
