# Reddit vertical extractors

There are two Reddit extractors: `reddit` (single post with top comments) and `reddit-listing` (subreddit feed).

Both use page fetch with robots.txt enforcement. They iterate through multiple API endpoints (`.json` suffix + old.reddit.com fallback) to handle blocking.

---

## `reddit` — Single post

**Matches:**
- `https://www.reddit.com/r/:subreddit/comments/:postId/:slug?`
- `https://old.reddit.com/r/:subreddit/comments/:postId/:slug?`
- `https://redd.it/:postId`

### Example

```
web_extract action=reddit url="https://www.reddit.com/r/typescript/comments/1abcde/announcing_typescript_50/"
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

### Example

```
web_extract action=reddit-listing url="https://www.reddit.com/r/typescript"
```

**Returns:** subreddit, sort, posts[{id, title, author, score, numComments, url, permalink, createdUtc, isNsfw, isSpoiler, flairText, linkFlair}], source

### Notes

- Both extractors try `www.reddit.com` `.json` → `old.reddit.com` `.json`.
- Rate limiting (429) is retryable.
- Post extractor fetches top 5 comments by default.

## Fallback when the vertical fails

If the vertical returns `URL metadata only` (Reddit's JSON API is blocked), the page is still readable. Fall back to:
- `web_browser` with `browserBackend=cloak` — drives a real browser, handles bot mitigation, returns the accessibility tree with comments, navigation, and user profiles
- Or `web_scrape` with `mode=browser browserBackend=cloak` — stateless read with a cloaked browser

CloakBrowser renders the full Reddit HTML page including post content, comments, and sidebar — bypassing Reddit's JSON API restrictions.
