# Changelog

All notable changes to `pi-scraper` are summarized from the git history and release tags.

## [0.10.1] - 2026-06-01

### Added

- **Custom vertical manifest docs** — documented YAML manifest overrides/additions in the README and bundled `web-scraping` skill, including project/user manifest locations and a dedicated custom vertical manifest reference.

### Changed

- **Vertical manifest README guidance** — clarified where agents can find YAML creation guidance and how to prompt an LLM/agent to use the bundled skill reference.

## [0.10.0] - 2026-05-31

### Added

- **Declarative YAML vertical manifests** — vertical extractors now load from typed YAML manifests, simplifying provider-specific extraction while preserving the stable `web_extract action="vertical"` tool surface.
- **Gitingest vertical extractor** — `web_extract action="vertical" extractor="gitingest"` returns LLM-ready GitHub repository digests for supported repositories.

### Changed

- **Flattened vertical manifest runtime** — simplified manifest loading/running internals while keeping public vertical names stable.
- **TUI renderer compaction and cache invalidation** — compacted tool result renderers and rebuilt pre-themed TUI strings on invalidation so theme changes refresh correctly.
- **Tool contract token optimization** — trimmed `web_extract` schema text while preserving routing cues for `action=vertical`, summaries, patterns, regex, JSON/schema, and provider examples.
- **Selection eval runner** — updated tool-selection evaluation to compile/import the current `src/tools/infra/register.ts` entrypoint and report prediction output paths correctly.

### Fixed

- **PyPI vertical URL capture** — fixed the PyPI manifest request template to use the captured project name.
- **Vertical rendering and progress** — improved generic vertical result rendering, extract progress rendering, multiline result-tree normalization, Hugging Face vertical usage guidance, and registry-load serialization.

### Removed

- **ast-grep config/dependency** — removed `sgconfig.yml` and `@ast-grep/cli`; CI/workflows no longer rely on ast-grep.

## [0.9.0] - 2026-05-23

### Added

- **Crawl Strategies** (`web_crawl`) — choose traversal strategy via the `strategy` parameter (`bfs`, `dfs`, or `best-first`).
  - `bfs` (Default): explores sibling pages at current depth first.
  - `dfs`: goes deep before wide using a LIFO/stack frontier (perfect for hierarchical document sub-trees).
  - `best-first`: dynamically sorts and prioritizes pages with highest structural/index value (uses a `depth * 10 + URL pattern bonus` scoring algorithm).
  - Active strategy is rendered directly in the live progress TUI card.
- **Proxy Pools & Health Tracking** (`web_scrape` & `web_crawl`) — route requests through rotating proxy arrays.
  - Pass single proxy string or string array: `proxy=["http://proxy1:8080", "http://proxy2:8080"]`.
  - ProxyPool manages round-robin rotation with concurrency-safe isolation.
  - Monitors proxy health: failed requests trigger a 60-second cooldown; 3 consecutive failures temporarily remove a proxy as unhealthy.
  - Fully integrated and compatible with TLS fingerprinting (`mode=fingerprint`).
- **Peer-Optional Fallback Model Adapter** (`@earendil-works/pi-ai`) — added optional lazy-loaded `@earendil-works/pi-ai` adapter for page-scoped summaries and adhoc extraction.
  - Tiered resolution: Pi's host model (`ctx.model`) -> `@earendil-works/pi-ai` adapter (using configs `piAiProvider`/`piAiModel`) -> cross-extension `pi:model-adapter/*` event-bus fallback.
  - Dynamic imports ensure a zero-dependency install footprint for users who only use deterministic tools.
- **"Instead of" Guides in Vertical Skill Docs** — Added "Instead of" sections across all 12 vertical extraction reference files. Helps agents avoid anti-patterns like custom `curl | jq | base64` shell pipelines, pointing them to single-call `web_extract` verticals instead.
- **Markdown semantic chunks** (`web_scrape`) — `chunks=true` returns paragraph-bounded, token-budgeted `chunks[]` alongside full markdown for RAG workflows (`maxTokens` default 500, `overlapTokens` default 50).
- **Selector self-healing** (`web_extract action=selector`) — third-tier text-anchor fallback when direct match and fingerprint relocation both fail; parses selector signals (tag/class/id) to find semantic neighbors.
- **Source-grounded adhoc extraction** (`web_extract action=adhoc`) — post-processes LLM output to locate each extracted value in cleaned source text; returns `grounded[]` with `{field, value, sourceSpan: {start, end}}` or `sourceSpan: null` when unverifiable.

## [0.8.3] - 2026-05-21

### Fixed

- Normalized request header keys before HTTP/2 dispatch so mixed-case `User-Agent` headers no longer crash `web_scrape` with `ERR_HTTP2_HEADER_SINGLE_VALUE`.

## [0.8.1] - 2026-05-20

### Added

- **CloakBrowser as default browser backend** — `mode=browser` now uses CloakBrowser by default; `browserBackend=playwright` provides explicit opt-out.
- **Persistent browser sessions** — `sessionId` + `saveSession=true` persists cookies/localStorage across calls and Pi restarts via `~/.pi/browser-sessions/<sessionId>/`.
- **Vertical browser fallback with visible markers** — `web_extract action=vertical mode=browser` pre-renders through Cloak and shows `browser fallback · cloak` in compact output.
- **Tool contract token optimization** — trimmed descriptions in `web_scrape` and `web_extract` schemas (~50 tokens saved).

### Changed

- Updated bundled skill docs with router guidance for JS-rendered/authenticated pages.
- Updated README with CloakBrowser quick-start and persistent session examples.

## [0.8.0] - 2026-05-20

### Added

- **YouTube vertical extractor** (`web_extract action="vertical" extractor="youtube"`) — fetches video metadata, transcript tracks, and best-effort comment previews via YouTube's Innertube ANDROID client (`20.10.38`).
  - Returns `title`, `channel`, `channelId`, `views`, `lengthSeconds`, `isLiveContent`, `publishedAt`, `thumbnail`.
  - Returns `transcript` with `languageCode`, `segments` (each with `start`, `duration`, `text`), and joined `text`.
  - Returns `transcriptTracks` array with `languageCode`, `name`, `kind`, and `isTranslatable`.
  - Returns `comments` (up to 20 preview comments) and `commentCount`.
  - Supports `youtube.com/watch`, `youtu.be`, `youtube.com/shorts` URLs with optional `?lang=`.
  - Handles both old `commentRenderer` and new `commentEntityPayload` structures.
  - Gracefully degrades when transcript or comments are unavailable (`transcriptStatus` / `commentsStatus` in `source` metadata).

- **Theme-aware vertical result rendering** — `renderVerticalResult` applies ANSI colors (green `✓`, red `✕`, muted `·`) via Pi's `renderResult` callback.
  - Expanded view shows transcript as flowing `│` text with timestamps, not individual tree connectors.
  - Structured tree sections for `video` metadata, `comments`, and `source` provider info.
  - Collapsed view shows compact summary line (`└─ ✓ youtube done · title · views · N segments`).
  - Answer context includes up to 2000 characters of transcript text for LLM consumption.

- **Batch result tree formatting** — batch result titles get `└─` prefix with progress counts (`2/2 done · ok 2 · err 0`).

- Updated bundled web-scraping skill docs with YouTube vertical routing guidance and per-vertical reference doc at `skills/web-scraping/references/verticals/youtube.md`.

### Fixed

- `renderVerticalResult` correctly reads through the `VerticalExtractionResult` wrapper (`details.data.data`) to access video metadata, transcript, and comments.
- `renderVerticalResult` error rendering: `└─ ✕ youtube failed · YOUTUBE_VIDEO_UNPLAYABLE` (red `✕`, muted error code).

## [0.7.0] - 2026-05-19

### Added

- `web_scrape` can write tagged snapshots inline via the `snapshotName` parameter.
- First-class binary download storage — `web_scrape` `saveToFile` writes fetched bytes to
  content-addressed local storage.
- Configurable `maxBytes` on `web_scrape` and `/scrape-config`; default raised to 30MB.

### Changed

- Folded `web_diff` into `web_scrape`'s `diff` parameter — diffing is now a `web_scrape` capability.
- Folded `web_summarize` into `web_extract action="summarize"` — page summaries route through
  `web_extract`.
- Trimmed tool contract token overhead via compact param descriptions and stripped type hints.
- Moved `summarize.ts` into `src/extract/`; collapsed single-file folders into sibling files.

### Removed

- `web_diff` and `web_summarize` as standalone tools (replaced by `web_scrape diff` and
  `web_extract action="summarize"`).

## [0.6.0] - 2026-05-18

### Added

- `github-repo` vertical extractor now surfaces README content and a depth-2 repository file tree.
- Session cookie support for `mode: "fingerprint"` — session cookies wired through the impit backend and `SafeFingerprintAdapter`.

### Changed

- Expanded bundled skill with per-mode, per-tool, and per-vertical reference docs under `skills/web-scraping/references/`.
- Limited vitest to 3 workers.
- Removed legacy `dup-check`, `similarity`, and `residue-check` scripts (and `.bin`) in favor of `ratch`.

### Fixed

- Fixed dead `session.md` link in the `fast.md` skill reference; now points to `fingerprint.md#session-cookies`.

## [0.5.1] - 2026-05-13

### Changed

- Updated bundled skill (`skills/web-scraping/SKILL.md`) with explicit `mode` enum (`fast|fingerprint|browser|auto`), fingerprint trigger heuristics (403/CF challenge/empty-shell), and `format=raw` + `linesMatching` examples.

## [0.5.0] - 2026-05-13

### Added

- **Bundled `impit` for `mode: "fingerprint"` zero-config.** Chrome/Firefox TLS fingerprint profiles ship out-of-the-box; auto-registered at module load with `registerFingerprintBackendFactory` swap hook for tests.
- **Streamed fingerprint response body with `maxBytes` bound during consumption.** impit returns `ReadableStream<Uint8Array>`; pi-scraper's `materializeFetchStreamResponse` enforces the limit mid-download. Buffer fallback preserved for custom backends.
- **DNS rebinding TOCTOU mitigation for fingerprint mode.** `SafeFingerprintAdapter` does a second DNS resolve immediately before connect and compares IP sets; throws `DNS_REBINDING_DETECTED` if they diverge. `fingerprintTrustLevel: "untrusted"` blocks fingerprint fetches against arbitrary URLs.
- Added `diagnostics.fingerprintRebindingMitigation` on every successful fingerprint fetch (strategy, preflight/connect addresses).
- Added injected `resolver` DI to `UrlSafetyOptions` for deterministic rebinding simulation tests.
- `meta-refresh` redirect support with hop cap (3) and SSRF guards.
- Alternate-link content-format fallback (e.g. `<link rel="alternate" type="application/...">`) when primary fetch yields no usable content.
- Raw inspection fetch mode (`web_scrape` `format: "raw"`) with inline line-match preview snippets and GitHub blob→raw normalization.
- `reddit-listing` vertical extractor for subreddit front pages.
- `respectRobots` parameter on `web_extract` vertical extraction.
- Progress UX wired through the vertical extraction stack.

### Changed

- Narrowed `ModelCapability` to `summarize | extract`.
- Dropped `@earendil-works/pi-ai` dependency; import `typebox` directly and inline `StringEnum`.
- Pinned `@mistralai/mistralai` to `2.2.1`.
- Bumped Pi engine requirement to `>=0.74.0` (`@earendil-works/pi-coding-agent`, `pi-tui` `^0.74.0`).

### Fixed

- Removed unnecessary `AlternateOutputFormat` cast after type simplification.
- Review fixes: abort stream cancel test, timeout wrap test, dropped `rebindingSuspected`, README note.

## [0.4.0] - 2026-05-13

### Added

- Adopted canonical Pi `ExtensionAPI` and resolved the host model from `ctx` at execute time for `web_summarize` and `web_extract action="adhoc"`.
- Added a cross-extension model-adapter event protocol (`pi:model-adapter/*`) with a registry, lazy capability-filtered discover, and a `DiscoverPayload` helper.
- Added optional `ModelUsage` propagation from adapter responses through envelopes, with a compact usage footer in expanded views.
- Added `/scrape-config` (renamed from `/web-config`), unifying `scrape-mode`, cache, and `reload` sub-actions with isolated config paths and tests.
- Rendered Markdown in `web_scrape`, `web_summarize`, `web_extract`, `web_get_result`, and crawl status envelopes via a shared Markdown component and theme helper.
- Added a dynamic excerpt cap with a 1000-char budget for batch/crawl expanded previews.

### Changed

- Removed `/web-set-mode` and `/web-reload-config`; their behavior is folded into `/scrape-config scrape-mode` and `/scrape-config reload`.
- Cached `loadEffectiveConfig` with explicit invalidation; shared a single undici Agent and RobotsCache; capped the in-memory sessions pool.
- Shared HTTP redirect-following, response materialization, error conversion, robots/politeness policy, and result-shaping primitives across static and fingerprint transports.
- Compressed session descriptions, deduped the provider schema, and dropped redundant min/max length constraints in tool inputs.
- Reorganized `src/tools`, `src/tui`, `src/storage`, `src/extract`, and related areas into action-based and per-responsibility folders. No public tool names changed.
- Resolved 474 oxlint errors and 292 oxlint warnings to 0 and reworked ast-grep rules for the new layout.

### Fixed

- Validated `Set-Cookie Domain` against the response host, scoped cookies to origin, enforced `Secure`, and applied RFC 6265 `Path` handling.
- Validated SSRF at connect and redirect time in the browser path: installed the subresource route guard at context creation, enforced SSRF for `sessionId`, blocked service workers, and added per-page DNS dedup with per-render DNS revalidation.
- Closed the Playwright page on session release to prevent leaks and released the global politeness permit when a host acquire aborts.
- Made storage migrations transactional, added a safe `JSON.stringify` fallback, redacted query strings in error URLs, made `closeStorageDbs` async, and wired process-exit cleanup hooks.
- Used Promise-keyed Maps to avoid session/db race-driven leaks and evict on rejection.
- Restored `options`/`scrapeDeps` pass-through in per-action extract handlers; fixed env precedence, schema hints, and `INCOMPATIBLE` reachability in tool selection.
- Removed the 500-char total cap from batch/crawl expanded previews.
- Updated bench build flags and paths for the restructured `src/` tree.

### Removed

- Deleted deprecated `extract`/`parse`/storage barrels and the dispatch surface; callers now import from canonical paths.

## [0.3.0] - 2026-05-08

### Added

- Added dedicated `web_summarize` support for page-scoped summaries.
- Added structured crawl/batch context packages and structured job manifests.
- Added code-adjacent docs extraction and API-surface extraction.
- Added freshness metadata and tagged snapshots.
- Added OSSInsight vertical extractors and API source URL metadata for vertical results.

### Changed

- Reduced public tool and bundled skill contract token overhead while preserving routing cues.
- Improved scrape parsing performance and lazy-loaded heavier runtime paths.
- Simplified internal HTTP, parse, storage, extraction, and renderer code paths while preserving behavior.

### Fixed

- Restored compact tool contracts and width-safe rendering.
- Kept vertical extraction guidance generic and provider-boundary-safe.

## [0.2.1] - 2026-05-04

### Added

- Added loader checklist tool renderers.
- Added richer agentic tool response context.
- Added real-world benchmark fixtures and reorganized benchmark suites.

### Fixed

- Tuned web tool renderer status output.
- Simplified web tool renderer icons.
- Allowed slower PDF extraction in tests.

## [0.2.0] - 2026-05-04

### Added

- Added SQLite-backed scraper storage cache.

### Changed

- Made the README easier to scan.

## [0.1.5] - 2026-05-04

### Changed

- Switched the DOM adapter runtime to `htmlparser2` for improved parsing performance.
- Ported production parsing to the DOM adapter architecture.
- Added DOM adapter benchmarks and parity gates.

## [0.1.4] - 2026-05-04

### Added

- Added DeepWiki extractor support.
- Added compact npm endpoint handling.
- Added `npmx.dev` support.
- Included Playwright as an optional dependency.

### Fixed

- Avoided browser waits on long-lived network activity.

## [0.1.3] - 2026-05-03

### Fixed

- Wrapped custom tool renderer output to match Pi expectations.

## [0.1.2] - 2026-05-03

### Added

- Improved crawl resume behavior and diff snapshot retrieval.
- Added Pi development toggle script.
- Documented parser replacement benchmark spike.

### Fixed

- Added npm provenance repository metadata.
- Aligned commands and renderers with Pi APIs.
- Scoped runtime files under the `pi-scraper` runtime namespace.
- Stabilized crawl concurrency assertions.
- Excluded local worktrees from Vitest runs.
- Updated install smoke command mock.

## [0.1.0] - 2026-05-03

### Added

- Scaffolded the Pi scraper extension.
- Wired model-backed extraction and page-scoped summaries.
- Added PDF text extraction.
- Added initial vertical API extractors.
- Added safe fingerprint backend boundary.

### Changed

- Simplified README and aligned project workflows.
