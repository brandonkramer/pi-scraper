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
