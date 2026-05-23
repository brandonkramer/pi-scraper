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

## Instead of

If you're tempted to reach for:
- `yt-dlp -j ... | jq ...` (heavy install, downloads video metadata)
- `python -m youtube_transcript_api ...` (extra pip install, Python dep)
- Manually parsing YouTube page HTML for metadata
- `curl innertube.googleapis.com/...` (custom API calls, bot detection)
- `wget -q -O - https://youtubetranscript.com/...` (third-party proxy, unreliable)

**Stop.** This vertical hits YouTube's Innertube API directly and returns structured metadata, captions, transcript segments, and top comments in one call. No extra Python deps, no yt-dlp, no HTML parsing.

## Browser fallback

Default to this vertical's API/direct HTTP path; it is faster and more reliable than browser rendering. Add `mode=browser` only as an explicit fallback when JS-rendered page state, bot mitigation, or a logged-in CloakBrowser session is needed. In browser mode, pi-scraper pre-renders the page with CloakBrowser and passes that rendered page to the extractor's page-fetch path.
