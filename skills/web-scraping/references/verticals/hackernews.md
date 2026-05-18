# Hacker News vertical extractor

**Action:** `hackernews`

**Matches:** `https://news.ycombinator.com/item?id=:id`

## Examples

```
# Story
web_extract action=hackernews url="https://news.ycombinator.com/item?id=40352809"

# Ask HN
web_extract action=hackernews url="https://news.ycombinator.com/item?id=40351000"

# Comment thread
web_extract action=hackernews url="https://news.ycombinator.com/item?id=40347281"

# Show HN
web_extract action=hackernews url="https://news.ycombinator.com/item?id=40349012"
```

**Returns:** id, type (story/comment/poll/job), title, url (external link), by, score, comments (descendants count), time (Unix timestamp), text (self-text if Ask/Show HN)

### Notes

- Uses the Firebase API (`hacker-news.firebaseio.com/v0/item/:id.json`) — not HTML scraping
- `title` and `url` are only present for story-type items
- `text` is the self-post body for Ask HN, Show HN, etc.
- `score` is the upvote count; `comments` is the total descendant count (not just top-level)
- Does NOT fetch the full comment tree — use the item's `text` field for Ask HN self-posts
