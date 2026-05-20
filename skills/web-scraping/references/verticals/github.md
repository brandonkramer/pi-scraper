# GitHub vertical extractors

## `github_repo`

**Matches:** `https://github.com/:owner/:repo`

Full repo intelligence — metadata + base64-decoded README + depth-2 file tree. Hits the GitHub API (3 parallel calls) — avoids robots.txt and heavy HTML scraping.

### Example

```
web_extract action=github_repo url="https://github.com/can1357/oh-my-pi"
```

**Returns:**
- `fullName`, `owner`, `name`, `description`, `url`
- `stars`, `forks`, `openIssues`, `defaultBranch`, `license`
- `readme` — base64-decoded README (Markdown, capped at 10k chars)
- `readmeTruncated` — true if README exceeded 10k chars
- `fileTree` — depth-2 tree as `[{path, type: "blob"|"tree", size?}]`

### Rules

- **Do NOT use `web_crawl` on github.com.** robots.txt + heavy HTML returns an empty frontier. Use this vertical instead.
- Hits the GitHub API directly — avoids all robots.txt/CAPTCHA/HTML-scraping issues.
- Unauthenticated rate limit: 60 req/hr (~20 full extractions). For heavy usage, provide `GITHUB_TOKEN` in your env.
- README and file tree failures are non-fatal — metadata still returns even if those calls 404/403.

---

## `github_issue`

**Matches:** `https://github.com/:owner/:repo/issues/:number`

### Example

```
web_extract action=github_issue url="https://github.com/facebook/react/issues/12345"
```

**Returns:** owner, repo, number, title, state, url, author, labels[], comments, createdAt, updatedAt, closedAt, isPullRequest

---

## `github_pr`

**Matches:** `https://github.com/:owner/:repo/pull/:number`

### Example

```
web_extract action=github_pr url="https://github.com/facebook/react/pull/25000"
```

**Returns:** owner, repo, number, title, state, url, author, draft, merged, baseRef, baseRepo, headRef, headRepo, additions, deletions, changedFiles, createdAt, updatedAt, closedAt, mergedAt

---

## `github_release`

**Matches:** `https://github.com/:owner/:repo/releases/tag/:tag`

### Example

```
web_extract action=github_release url="https://github.com/facebook/react/releases/tag/v18.2.0"
```

**Returns:** owner, repo, tag, name, url, draft, prerelease, author, publishedAt, createdAt, body, assets[{name, size, downloads, url}]

## Browser fallback

Default to this vertical's API path; it is faster and more reliable than browser rendering. Use `mode=browser` only as an explicit fallback when the normal API path is blocked/rate-limited or when you need a logged-in CloakBrowser session (`sessionId` + `saveSession=true`).
