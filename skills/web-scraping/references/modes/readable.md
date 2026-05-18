# `readable` mode

Extracts article-like content using the Readability algorithm. Strips navigation, ads, sidebars — returns clean article text.

## When to use

Blog posts, news articles, documentation — any page where you want the main content without chrome.

```
# Blog post
web_scrape url="https://example.com/blog/post" mode=readable

# News article
web_scrape url="https://news.example.com/article" mode=readable
```

## Notes

- Does NOT execute JS — works on server-rendered content
- If the page requires JS to load its article content, use `browser` mode instead
- Uses Defuddle for the readability extraction (lightweight, no browser dependency)
