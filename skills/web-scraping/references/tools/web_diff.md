# `web_diff`

Compare current page content against a stored snapshot.

## Args

| Parameter | Type | Description |
|-----------|------|-------------|
| `url` | string | URL to diff (required) |
| `snapshotName` | string | Name for the snapshot |
| `snapshotTag` | string | Tag for the snapshot |
| `compareTag` | string | Compare against a different tag |
| `maxSnapshotAgeSeconds` | number | Max age for auto-baseline |
| `mode` | enum | Scrape mode |

## Examples

```
# Diff against latest snapshot (auto-baseline)
web_diff url="https://example.com"

# Named snapshot
web_diff url="https://example.com" snapshotName="v2-migration"

# Tagged snapshot
web_diff url="https://example.com" snapshotTag="release-1.0"

# Compare two tags
web_diff url="https://example.com" snapshotTag="release-1.0" compareTag="release-0.9"
```

## Rules

- Snapshots are stored under `~/.pi/snapshots/`.
- If no snapshot exists for the URL, the current fetch becomes the baseline (no diff output).
- Named/tagged snapshots let you version pages for tracking changes over time.
