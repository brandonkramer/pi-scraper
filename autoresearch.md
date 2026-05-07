# Autoresearch: optimize performance of web scrape

## Objective

Reduce end-to-end CPU time of `scrapeUrl(mode: "fast", format: "markdown")` across the eval corpus fixtures. The benchmark exercises the full pipeline: HTTP stub → content-type routing → HTML parsing (htmlparser2) → fast extraction → markdown serialization (Turndown) → truncation → result finishing.

## Metrics

- **Primary**: `total_median_ms` (ms, lower is better) — sum of median scrape time across all 10 eval corpus cases
- **Secondary**:
  - `large_docs_ms` — median time for `large-docs-page` (the dominant bottleneck at ~33ms)
  - `static_article_ms` — small-fixture baseline
  - `mean_median_ms` — mean of per-case medians (catches broad improvements)

## How to Run

`./autoresearch.sh` — outputs `METRIC` lines and a summary.

The script runs `node bench/bin/bench.mjs eval/corpus.json --warmup=5 --repeats=30` and parses the resulting JSON report.

## Files in Scope

- `src/parse/fast.ts` — top-level fast extraction orchestrator
- `src/parse/htmlparser2-dom-adapter.ts` — DOM adapter (htmlparser2 + css-select + domutils + dom-serializer)
- `src/parse/selectors.ts` — `prepareDocument`, `selectedRoots`, `visibleText`, `outerHtml`
- `src/parse/noise.ts` — `rankMainCandidates`, `linkDensity`, `mainContentRoot`
- `src/parse/metadata.ts` — `extractMetadata`, `extractHeadings`, `extractLinks`
- `src/parse/data-islands.ts` — `recoverDataIslands`
- `src/parse/recovery.ts` — `recoverUsefulContent`
- `src/scrape/render.ts` — `materializeFormat`, `renderFormat`, `finishResult`
- `src/scrape/signals.ts` — `analyzeFastResult`, `combineRecoveredText`
- `src/serialize/markdown.ts` — `htmlToMarkdown` (Turndown wrapper)
- `src/serialize/text.ts` — `normalizeWhitespace`
- `src/scrape/modes/fast.ts` — `httpScrape`, `responseScrape`, `htmlResult`

## Off Limits

- Do not change eval fixtures or corpus expected signals
- Do not change the Turndown dependency or replace it with a different markdown serializer
- Do not change HTTP client behavior (network layer)
- Do not change content-type routing or PDF handling
- Do not remove extraction features visible in result types
- Do not change TypeBox schemas or Pi tool interfaces

## Constraints

- All existing tests must pass (`npm test`)
- TypeScript must compile (`npm run typecheck`)
- Extraction quality must be preserved (eval corpus signals must still pass)
- No new runtime dependencies

## What's Been Tried

(nothing yet — baseline established at start)
