# `web_scrape diff`

Compare current page content against a stored snapshot via `web_scrape({ url, diff })`.

## Args

| Parameter | Type | Description |
|-----------|------|-------------|
| `url` | string | URL to diff (required) |
| `diff` | boolean/object | `true` for latest baseline, or `{ snapshotName?, snapshotTag?, compareTag?, maxSnapshotAgeSeconds? }` |
| `mode` | enum | Scrape mode; use `browser` for Cloak-rendered page diffs |
| `browserBackend` | enum | `cloak` (default) or `playwright` when `mode=browser` |
| `format` | enum | Prefer `markdown` or `text` for lower-noise browser diffs |
| `sessionId` / `saveSession` | string/boolean | Reuse persistent Cloak sessions for authenticated diffs |

## Examples

```
# Diff against latest snapshot (auto-baseline)
web_scrape url="https://example.com" diff=true

# Named snapshot
web_scrape url="https://example.com" diff={"snapshotName":"v2-migration"}

# Tagged snapshot
web_scrape url="https://example.com" diff={"snapshotTag":"release-1.0"}

# Compare two tags
web_scrape url="https://example.com" diff={"snapshotTag":"release-1.0","compareTag":"release-0.9"}

# Browser/Cloak diff: compare what a real browser sees
web_scrape url="https://example.com/dashboard" mode=browser browserBackend=cloak format=markdown diff=true

# Authenticated browser diff with persistent Cloak session
web_scrape url="https://example.com/dashboard" mode=browser browserBackend=cloak format=markdown sessionId="example-login" saveSession=true diff=true
```

## Rules

- Snapshots are stored under `~/.pi/snapshots/`.
- If no snapshot exists for the URL, the current fetch becomes the baseline (no diff output).
- Named/tagged snapshots let you version pages for tracking changes over time.
- Use `snapshotName` alone on `web_scrape` to write a baseline; `diff` to compare.
- Browser/Cloak diffs are useful for JS-rendered, bot-gated, or authenticated pages.
- Prefer `format=markdown` or `format=text`; raw `html` diffs are often noisy due to hydration IDs, ads, timestamps, and A/B tests.
