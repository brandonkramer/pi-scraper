# GitLab vertical extractor

**Action:** `gitlab`

**Matches:** `https://gitlab.com/:owner/:repo`, `https://:host/:owner/:repo` (self-hosted GitLab instances)

### Examples

```
# GitLab.com project
web_extract action=vertical extractor=gitlab url="https://gitlab.com/gitlab-org/gitlab"

# Self-hosted GitLab instance
web_extract action=vertical extractor=gitlab url="https://gitlab.example.com/myorg/myrepo"
```

**Returns:** fullName, owner, name, description, url, stars, forks, openIssues, defaultBranch, visibility, topics[], readme, readmeTruncated, fileTree[]

### Notes

- Uses the GitLab REST API v4 (`/api/v4/projects/:id`) — project path is URL-encoded as `owner%2Frepo`
- `readme` is base64-decoded from the API response and truncated to 10,000 chars
- `readmeTruncated` is `true` when the readme exceeds 10,000 chars
- `fileTree` is a top-level listing (`per_page=100`) with `{id, name, type, path}` objects
- `visibility` is the project visibility level (`"public"`, `"internal"`, or `"private"`)
- `topics` is an array of topic labels
- No auth required for public projects; private/internal projects will return API errors
- Self-hosted GitLab instances are matched via `:host` capture — the HTTP client's SSRF checks prevent requests to private-network hosts

## Instead of

If you're tempted to reach for:
- `curl -s "https://gitlab.com/api/v4/projects/org%2Frepo" | jq` (manual API calls, JSON parsing, field extraction)
- HTML scraping the rendered project page (fragile selectors)
- `python-gitlab` (extra pip install, Python dep)

**Stop.** This vertical calls the GitLab API v4 server-side and returns structured project metadata, README, and file tree in one call. No extra packages, no HTML parsing.

## Browser fallback

Default to the API path; browser mode is not typically needed for GitLab. Add `mode=browser` only if JS-rendered state or a logged-in session is required.
