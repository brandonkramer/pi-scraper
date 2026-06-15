# Stack Overflow vertical extractor

**Action:** `stackoverflow`

**Matches:**
- `https://stackoverflow.com/questions/:id`
- `https://stackoverflow.com/questions/:id/:slug`

## Examples

```
# Question with slug
web_extract action=vertical extractor=stackoverflow url="https://stackoverflow.com/questions/11227809/why-is-conditional-processing-of-a-sorted-array-faster-than-of-an-unsorted-array"

# Question id only
web_extract action=vertical extractor=stackoverflow url="https://stackoverflow.com/questions/11227809"

# With Stack Exchange API key (higher quota)
web_extract action=vertical extractor=stackoverflow url="https://stackoverflow.com/questions/11227809/example?key=YOUR_KEY"
```

**Returns:** id, slug, title, body (HTML), tags, score, viewCount, answerCount, isAnswered, link, acceptedAnswerId, createdAt, lastActivityAt, owner{displayName, reputation, profileUrl, userId}, answers[{id, body, score, isAccepted, createdAt, lastActivityAt, owner}], comments[{id, body, score, createdAt, owner}]

### Notes

- Uses the Stack Exchange API (`api.stackexchange.com/2.3`) — not HTML scraping
- Fetches question metadata, top answers (by votes, up to 30), and top comments (by score, up to 30) in parallel
- `body` fields are HTML from the API (`filter=withbody`)
- Append `?key=YOUR_KEY` to the URL to forward a Stack Exchange API key for higher rate limits
- Does NOT fetch answer comments or the full comment tree on answers

## Instead of

If you're tempted to reach for:
- `curl -s 'https://api.stackexchange.com/2.3/questions/:id?site=stackoverflow&filter=withbody' | jq ...` (raw API, multiple calls for answers/comments)
- `curl -s 'https://stackoverflow.com/questions/:id' | grep ...` (HTML scraping, fragile)

**Stop.** This vertical calls the Stack Exchange API internally and returns structured question/answers/comments in one call. No `jq`, no HTML parsing.

## Browser fallback

Default to this vertical's API/direct HTTP path; it is faster and more reliable than browser rendering. Add `mode=browser` only as an explicit fallback when JS-rendered page state, bot mitigation, or a logged-in CloakBrowser session is needed. In browser mode, pi-scraper pre-renders the page with CloakBrowser and passes that rendered page to the extractor's page-fetch path.
