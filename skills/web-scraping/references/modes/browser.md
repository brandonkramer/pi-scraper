# `browser` mode

Full browser rendering via **CloakBrowser** (default) with optional fallback to stock Playwright.

## When to use

- JavaScript-rendered SPAs (React, Vue, Angular)
- Sites that block `fingerprint` mode too
- Sites requiring browser-specific features (WebGL, canvas fingerprinting)

```
# SPA (uses CloakBrowser by default)
web_scrape url="https://spa.example.com" mode=browser

# Site that requires full browser
web_scrape url="https://example.com" mode=browser
```

## Default: CloakBrowser

`mode=browser` uses **CloakBrowser** by default — a patched Chromium binary with 48 C++-level fingerprint patches that passes Cloudflare Turnstile, reCAPTCHA v3, and 30+ detection sites.

The CloakBrowser binary auto-downloads on first launch (~200 MB, cached at `~/.cloakbrowser/`).

## Playwright backend

To use stock Playwright Chromium instead:

```
web_scrape url="https://example.com" mode=browser browserBackend=playwright
```

This requires Playwright to be installed: `npm install playwright` and `npx playwright install chromium`.

## Backend options

| Value | Browser | Stealth at | Requirement |
|-------|---------|------------|-------------|
| `"cloak"` (default) | CloakBrowser patched Chromium 145 | C++ source level | Bundled |
| `"playwright"` | Stock Chromium | JS evaluate (stealth=true) | `npm install playwright` |

## Session

Browser mode uses Playwright's own browser context for cookies — separate from the session store used by `fast`/`fingerprint`.

## Stealth

When using the Playwright backend (`browserBackend=playwright`), set `stealth=true` to apply JS-level anti-detection patches:

```
web_scrape url="https://example.com" mode=browser browserBackend=playwright stealth=true
```

CloakBrowser does not need `stealth=true` — all patches are applied at the C++ level.

## Auto-wait

Set `autoWait=true` to wait for network idle before extracting:

```
web_scrape url="https://spa.example.com" mode=browser autoWait=true
```

## Timezone / Locale

CloakBrowser supports timezone and locale via binary flags (undetectable):

```
web_scrape url="https://example.com" mode=browser timezone="America/New_York" locale="en-US"
```

For the Playwright backend, these are applied via JS stealth patches (detectable via CDP).
