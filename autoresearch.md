# Autoresearch: simplify src/tui

## Objective
Reduce production LOC in `src/tui` while preserving identical rendered behavior for the existing Pi web-tool TUI. Favor reusable helpers, consistent renderer patterns, and simple readable TypeScript over clever golfing. The user specifically wants lower LOC, re-usability, consistency, and simplicity with the same result.

## Metrics
- **Primary**: `tui_loc` (lines, lower is better) — total physical lines in production TypeScript files under `src/tui`, excluding `src/tui/__tests__`.
- **Secondary**:
  - `tui_nonblank_loc` — nonblank production lines.
  - `renderer_loc` — production lines under `src/tui/renderers`.
  - `shared_loc` — production lines directly under `src/tui`.
  - `max_file_lines` — largest production TUI file; must remain under the project 500-line cap.
  - `file_count` — production TUI TypeScript file count.

## How to Run
`./autoresearch.sh` — outputs `METRIC name=number` lines. `run_experiment` also runs `./autoresearch.checks.sh` after successful metric collection.

## Files in Scope
- `src/tui/*.ts` — shared TUI primitives, theming, cards, status pills, resource rows, result trees, labels, exports.
- `src/tui/renderers/*.ts` — web tool renderers for scrape, crawl, batch, map, diff, extract, vertical extraction, and stored result lookup.
- `src/tui/__tests__/components.test.ts` — only when needed to update/add coverage for behavior-preserving refactors.
- `src/tools/__tests__/renderers.test.ts` — only when needed to update/add renderer contract coverage.
- `autoresearch.md`, `autoresearch.sh`, `autoresearch.checks.sh`, `autoresearch.ideas.md` — experiment state/instrumentation.

## Off Limits
- Do not change public tool names, schemas, or Pi manifest.
- Do not change network, scrape, crawl, storage, SSRF, model, or provider behavior.
- Do not add dependencies or lockfile changes.
- Do not minify, obfuscate, remove meaningful names, or collapse code in a way that hurts readability just to reduce LOC.
- Do not touch generated artifacts directly.

## Constraints
- Rendered behavior should remain the same for existing tests and snapshots/contract assertions.
- Project TypeScript file cap remains 500 lines.
- Checks must pass before keeping an experiment: `npm run typecheck` and relevant TUI/renderer tests.
- Follow project code-quality rules: no new `any`, unsafe casts, lint disables, skipped tests, broad swallowing, or speculative abstractions.
- Before editing an existing symbol, run GitNexus impact analysis when the CLI can resolve that symbol; warn if HIGH/CRITICAL risk.

## What's Been Tried
- Baseline setup only. Initial source read shows the largest opportunities are repeated renderer patterns (expanded response IDs, model/freshness summaries, list/tree blocks) and helper-level duplication in vertical list rendering, scrape sections, and batch/crawl summaries.
