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

- Both extractors try `www.reddit.com` `.json` → `old.reddit.com` `.json`. If robots.txt blocks all, returns `blocked: true` with `source.attemptedEndpoints`.
- Rate limiting (429) is retryable.
- Post extractor fetches top 5 comments by default.
- **No bypass available.** Reddit's robots.txt is enforced.

## Instead of

If you're tempted to reach for:
- `curl -s 'https://www.reddit.com/r/:sub/.json' | jq ...` (may be blocked by robots.txt)
- `curl -s 'https://old.reddit.com/r/:sub/comments/:id/.json' | jq ...` (same issue)
- Scraping Reddit's HTML and parsing it manually

**Stop.** This vertical handles robots.txt enforcement, endpoint fallback (new Reddit → old Reddit), and structured output for posts and subreddit feeds — in one call. No manual `.json` suffix juggling.

## Browser fallback

Default to this vertical's API/direct HTTP path; it is faster and more reliable than browser rendering. Add `mode=browser` only as an explicit fallback when JS-rendered page state, bot mitigation, or a logged-in CloakBrowser session is needed. In browser mode, pi-scraper pre-renders the page with CloakBrowser and passes that rendered page to the extractor's page-fetch path.
