# `web_get_result`

Retrieve previously stored results, job manifests, or snapshot listings.

## Args

| Parameter | Type | Description |
|-----------|------|-------------|
| `responseId` | string | Retrieve a stored scrape/crawl result |
| `jobId` | string | Retrieve a job manifest |
| `snapshotUrl` | string | List snapshots for a URL |
| `snapshotName` | string | Filter snapshots by name |
| `snapshotTag` | string | Filter snapshots by tag |

## Examples

```
# Get a stored scrape result
web_get_result responseId="abc-123-def"

# Get a job manifest
web_get_result jobId="crawl-xyz-789"

# List snapshots for a URL
web_get_result snapshotUrl="https://example.com"

# List snapshots filtered by name
web_get_result snapshotUrl="https://example.com" snapshotName="v2-migration"

# List snapshots by tag
web_get_result snapshotUrl="https://example.com" snapshotTag="release-1.0"
```

## Rules

- Provide exactly one of `responseId`, `jobId`, or `snapshotUrl`.
- Stored results include a `summary` and `answerContext` fields to help the LLM understand what was retrieved.
