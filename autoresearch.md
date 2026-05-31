# Autoresearch: src/tui LOC and reuse

## Objective
Reduce physical TypeScript LOC under `src/tui` while preserving the rendered output and public TUI exports. Favor reusable local helpers that remove duplication across renderer/card/status modules. The workload measures non-test `src/tui/**/*.ts` line count; correctness checks guard behavior with typecheck and targeted TUI/renderer tests.

## Metrics
- **Primary**: `tui_loc` (lines, lower is better) — physical lines in non-test `src/tui/**/*.ts`.
- **Secondary**: `max_file_loc`, `file_count`, `renderer_loc`, `helper_loc` — tradeoff monitors for oversized files and helper growth.

## How to Run
`./autoresearch.sh` — outputs `METRIC name=number` lines.

## Files in Scope
- `src/tui/**/*.ts` except `src/tui/__tests__/**` — TUI components, shared formatting helpers, and web tool result renderers.
- `src/tui/__tests__/components.test.ts` — only if a reusable behavior-preserving helper needs direct TUI component coverage.
- `autoresearch.md`, `autoresearch.sh`, `autoresearch.checks.sh`, `autoresearch.ideas.md` — experiment harness and notes.

## Off Limits
- Public tool names, Pi manifest, network/http/scrape behavior, and non-TUI tool adapters.
- Deleting meaningful tests or weakening assertions to improve LOC.
- Adding dependencies, changing lockfiles, or moving broad model/search/research responsibilities.

## Constraints
- Same rendered behavior or better; primary metric may only be kept when targeted checks pass.
- No new dependencies.
- Keep TypeScript files under 500 lines.
- Preserve public `src/tui/index.ts` exports unless a removed export is provably unused and behavior-neutral.
- Before editing a function/class/method, run GitNexus impact analysis for the symbol and record the blast radius.

## What's Been Tried
### Results
**Best: 2413 LOC** (from baseline 2586, saved 173 LOC / 6.7%)

### Kept changes (16)
1. **splitValueByWidth export + reuse** (-12): Removed duplicate transcript wrapping in vertical renderer.
2. **groupEntries inline** (-4): Inlined one-use private group mapper in scrape.
3. **renderSpinner inline** (-4): Inlined one-use spinner into withSpinnerFooter.
4. **Spinner co-location** (-2): Moved SPINNER_FRAMES/currentSpinnerFrame into tool-status.
5. **DEFAULT_HIDDEN_EXPANDED_KEYS compaction** (-2): Compacted multiline string split.
6. **renderMetadataLines removal** (-21): Removed unused exported metadata formatter.
7. **cacheLabel removal** (-6): Removed unused cache label helper.
8. **renderMapResultCard removal** (-13): Removed unused map result-card wrapper.
9. **stripTextPadding inline** (-4): Inlined one-use private text trim helper.
10. **renderUrlBadgeRow inline** (-14): Inlined one-use badge row helper into toolResource.
11. **renderUrlStatusRow inline** (-23): Inlined one-use status row helper into toolResourceStatus.
12. **Progress count segment dedup** (-5): Shared formatter for succeeded/failed/cache-hit counts.
13. **truncateMiddle inline** (-3): Inlined one-use URL truncation helper.
14. **Model usage/cost inlining** (-13): Inlined formatModelUsage/tokenSuffix/formatCostUSD.
15. **Extract all 4 helpers inline** (-25): Inlined extractSummary/extractLoader/extractTree/expandedExtractText.
16. **Diff helpers inline** (-21): Inlined renderChecklistResult and diffTitle.

### Discarded patterns
- **Merging re-export shims** (tool-text → tool-format): saved 1 file but increased total LOC. The re-export lines outweighed the deleted file.
- **Micro-inlining small helpers** (paintBgLine, trunctateMiddle was borderline, parseAgeSeconds): Private functions under 5 lines cost more to inline than they save.
- **Inlining medium helpers with complex bodies** (renderResourceItemLines, batchItemGroup): The arrow-wrapper overhead + body brackets made the inline version longer.

### Key insight
Biggest wins came from:
1. **Removing unused code** (metadata formatter, cache label, map wrapper) — safe, zero-risk, ~40 LOC.
2. **Inlining moderately-sized (10-25 line) single-use private exports** (renderUrlStatusRow, diff helpers, extract helpers) — 15-25 LOC savings each because function declaration overhead + blank lines are real.
3. **Eliminating small files** (spinner co-location, tool-text merge attempted) — minimal per-file savings.

Small helpers (<5 lines) should NOT be inlined. Medium helpers (10-25 lines with 1 caller) should be inlined if they're private or have no external callers.