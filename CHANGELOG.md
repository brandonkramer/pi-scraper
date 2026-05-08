# Changelog

All notable changes to `pi-scraper` are summarized from the git history and release tags.

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
