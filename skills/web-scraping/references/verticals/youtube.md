# YouTube vertical

Use `web_extract action="vertical" extractor="youtube" url="https://www.youtube.com/watch?v=..."` for structured video metadata.

Returns:
- `title`, `description`, `channel`, `channelId`
- `views`, `lengthSeconds`, `isLiveContent`
- `transcript` with language, generated/manual flag, segments, and joined text when available
- `transcriptTracks` for available caption languages
- up to 20 top-level `comments` when YouTube's comments continuation is available

Supported URLs:
- `https://www.youtube.com/watch?v=<id>`
- `https://youtu.be/<id>`
- `https://www.youtube.com/shorts/<id>`

Optional: append `?lang=<code>` to prefer a transcript language, e.g. `?lang=es`.

Notes:
- Uses YouTube's Innertube endpoints; availability can vary by region, age restriction, consent state, or bot-detection.
- Comments are best-effort preview data. Some videos return only a comments heading/count placeholder.

## Browser fallback

Default to this vertical's API/direct HTTP path; it is faster and more reliable than browser rendering. Add `mode=browser` only as an explicit fallback when JS-rendered page state, bot mitigation, or a logged-in CloakBrowser session is needed. In browser mode, pi-scraper pre-renders the page with CloakBrowser and passes that rendered page to the extractor's page-fetch path.
