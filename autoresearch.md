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
- Baseline: `tui_loc=2049` production LOC under `src/tui`.
- Kept wins so far: extract selector reuses `toolResultCard` response-id expansion; batch progress returns done text directly; vertical description preview uses one template literal; single-use comment truncation is inlined; diff summaries reuse `toolStatus` and removed single-use `joinSegments`; byte formatting uses a single post-guard ternary; HTTP time formatting uses one return; stored-result rendering reuses `toolStackedCard`; crawl excerpt selection uses a local variable instead of an IIFE. Current best observed: `tui_loc=2032`.
- Dead ends: generic vertical list helper increased LOC; crawl lookup stacked-card rewrite grew; combined resource exports grew under oxfmt; crawl optional chaining grew; scrape trace response-id inline was neutral; nested ternaries for formatters/blocked reason grew; direct extract tree ternary grew; map stacked-card rewrite grew.
- Formatter lesson: oxfmt often expands nested ternaries and large object-call expressions. Prefer early returns and local variables unless a ternary stays flat on one line.
- Reuse lesson: existing `toolStackedCard`/`toolResultCard` helps when it replaces custom background/response-id line plumbing, but can grow small renderers due object boilerplate.
