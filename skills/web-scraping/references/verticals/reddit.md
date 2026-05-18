# Reddit vertical extractors

There are two Reddit extractors: `reddit` (single post with top comments) and `reddit-listing` (subreddit feed).

Both use page fetch (`fetchPage`) with robots.txt enforcement. They iterate through multiple API endpoints (`.json` suffix + old.reddit.com fallback) to handle blocking.

---

## `reddit` — Single post

**Matches:**
- `https://www.reddit.com/r/:subreddit/comments/:postId/:slug?`
- `https://old.reddit.com/r/:subreddit/comments/:postId/:slug?`
- `https://redd.it/:postId`

### Examples

```
# Full URL with slug
web_extract action=reddit url="https://www.reddit.com/r/typescript/comments/1abcde/announcing_typescript_50/"

# Short redd.it URL
web_extract action=reddit url="https://redd.it/1abcde"

# Old Reddit URL
web_extract action=reddit url="https://old.reddit.com/r/programming/comments/1xyz/hello_world/"
```

**Returns:** id, subreddit, title, author, createdUtc, permalink, url, selfText, score, upvoteRatio, commentCount, flairText, isNsfw, isSpoiler, isLocked, isStickied, isArchived, topComments[{id, author, body, score, createdUtc, permalink}], source

---

## `reddit-listing` — Subreddit feed

**Matches:**
- `https://www.reddit.com/r/:subreddit` (default: hot)
- `https://www.reddit.com/r/:subreddit/top`
- `https://www.reddit.com/r/:subreddit/new`
- `https://www.reddit.com/r/:subreddit/hot`
- `https://www.reddit.com/r/:subreddit/rising`

### Examples

```
# Hot posts
web_extract action=reddit-listing url="https://www.reddit.com/r/typescript"

# Top posts
web_extract action=reddit-listing url="https://www.reddit.com/r/programming/top"

# New posts
web_extract action=reddit-listing url="https://www.reddit.com/r/javascript/new"

# Rising posts
web_extract action=reddit-listing url="https://www.reddit.com/r/rust/rising"

# Hot (explicit)
web_extract action=reddit-listing url="https://www.reddit.com/r/linux/hot"
```

**Returns:** subreddit, sort, posts[{id, title, author, score, numComments, url, permalink, createdUtc, isNsfw, isSpoiler, flairText, linkFlair}], source

### Notes

- Both extractors try multiple endpoints in order: `www.reddit.com` `.json` → `old.reddit.com` `.json`
- If robots.txt blocks all endpoints, returns a `blocked: true` response with `source.attemptedEndpoints`
- Rate limiting (429) is considered retryable
- Post extractor fetches top 5 comments by default
- The `selfText` field contains the post body (may be empty for link posts with `url_overridden_by_dest`)

### Rules

- **No bypass available.** Reddit's robots.txt is enforced — pi-scraper will not scrape HTML to bypass it.
- Both extractors try multiple endpoints in order: `www.reddit.com` `.json` → `old.reddit.com` `.json`. If all are blocked by robots, returns `blocked: true`.
- Rate limiting (429) is retryable; all other blocks are permanent.
