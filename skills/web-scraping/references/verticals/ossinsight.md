# OSSInsight vertical extractors

OSSInsight provides analytics for open-source GitHub repos. Four extractors cover collections, rankings, trending, and repo analytics.

---

## `ossinsight_collections`

**Matches:** `https://ossinsight.io/collections[/]`

Lists all available OSSInsight collections.

### Examples

```
web_extract action=ossinsight_collections url="https://ossinsight.io/collections"
web_extract action=ossinsight_collections url="https://ossinsight.io/collections/"
```

**Returns:** collections[{id, name}]

---

## `ossinsight_collection_ranking`

**Matches:** `https://ossinsight.io/collections/:slug`

Rankings within a collection. Supports URL query parameters: `?metric=` and `?period=`.

**Metrics:** `stars` (default), `pull-requests`, `issues`
**Periods:** `past_24_hours`, `past_28_days` (default), `past_month`

### Examples

```
# Default ranking (stars, past 28 days)
web_extract action=ossinsight_collection_ranking url="https://ossinsight.io/collections/artificial-intelligence"

# Pull requests this month
web_extract action=ossinsight_collection_ranking url="https://ossinsight.io/collections/artificial-intelligence?metric=pull-requests&period=past_month"

# Issues, last 24 hours
web_extract action=ossinsight_collection_ranking url="https://ossinsight.io/collections/data-science?metric=issues&period=past_24_hours"
```

**Returns:** collection{id, name, slug}, metric, period, rows[{repo_name, stars?, forks?, pull_requests?, issues?, total_score?}]

---

## `ossinsight_trending_repos`

**Matches:** `https://ossinsight.io/trending`, `https://ossinsight.io/trending/:language`

Periods: `past_24_hours` (default), `past_week`, `past_month`

### Examples

```
# All languages, past 24 hours
web_extract action=ossinsight_trending_repos url="https://ossinsight.io/trending"

# TypeScript, past week
web_extract action=ossinsight_trending_repos url="https://ossinsight.io/trending/typescript?period=past_week"

# Rust, past month
web_extract action=ossinsight_trending_repos url="https://ossinsight.io/trending/rust?period=past_month"
```

**Returns:** period, language, rows[{repo_name, stars?, forks?, pull_requests?, pushes?, total_score?, primary_language?, description?}]

---

## `ossinsight_repo_analytics`

**Matches:** `https://ossinsight.io/analyze/:owner/:repo`

Stargazer history for a specific repo (monthly).

### Examples

```
web_extract action=ossinsight_repo_analytics url="https://ossinsight.io/analyze/facebook/react"
web_extract action=ossinsight_repo_analytics url="https://ossinsight.io/analyze/vercel/next.js"
web_extract action=ossinsight_repo_analytics url="https://ossinsight.io/analyze/torvalds/linux"
```

**Returns:** owner, repo, stargazers[{event_month, stars?, total?}]

### Notes

- All use the OSSInsight API (`api.ossinsight.io/v1/...`)
- `rows` in rankings/trending contains per-repo stats; `stars`, `forks`, etc. may be omitted if zero
- `total` in repo analytics is the cumulative stargazer count at that month
- The `ossinsight_collection_ranking` extractor matches collection slugs to IDs via a lookup against `ossinsight_collections`
