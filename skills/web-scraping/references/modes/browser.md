# `browser` mode

Full browser rendering via Playwright.

## When to use

- JavaScript-rendered SPAs (React, Vue, Angular)
- Sites that block `fingerprint` mode too
- Sites requiring browser-specific features (WebGL, canvas fingerprinting)

```
# SPA
web_scrape url="https://spa.example.com" mode=browser

# Site that requires full browser
web_scrape url="https://example.com" mode=browser
```

## Requirements

Playwright must be installed separately. Not needed for normal pi-scraper installs — this mode is peer-optional and lazy-loaded:

```
npx playwright install chromium
```

## Session

Browser mode uses Playwright's own browser context for cookies — separate from the session store used by `fast`/`fingerprint`.

## Stealth

Set `stealth=true` to apply anti-detection patches (navigator.webdriver, etc.):

```
web_scrape url="https://example.com" mode=browser stealth=true
```

## Auto-wait

Set `autoWait=true` to wait for network idle before extracting:

```
web_scrape url="https://spa.example.com" mode=browser autoWait=true
```
