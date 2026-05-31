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
- Baseline after portable harness: `tui_loc=2586`, `file_count=23`, `renderer_loc=1271`, `helper_loc=1315` with typecheck and targeted TUI/renderer tests passing.
- Kept: exported `splitValueByWidth` from `tool-result-tree.ts` and reused it for vertical transcript wrapping (`tui_loc=2574`). This removed duplicate wrapping logic and centralized width splitting.
- Kept: inlined the one-use private `groupEntries` helper in `renderers/scrape.ts` (`tui_loc=2570`). Low-risk because it had one caller.
- Kept: inlined one-use `renderSpinner` into `withSpinnerFooter` (`tui_loc=2566`) after confirming no direct imports.
- Kept: moved spinner frames/current frame primitive into `tool-status.ts` and removed `tool-spinner.ts` (`tui_loc=2564`, `file_count=22`).
- Kept: compacted `DEFAULT_HIDDEN_EXPANDED_KEYS` construction in `tool-result.ts` (`tui_loc=2562`).
- Discarded: merging `tool-text.ts` into `tool-format.ts` reduced `file_count` but increased total LOC to 2573. Do not retry unless primary metric changes.
- Discarded: micro-collapsing the final vertical transcript return increased total LOC to 2563. Target larger structural reuse instead.
- Avoided: inlining `TONE_FNS`/touching `paintPart`; GitNexus reported CRITICAL blast radius through `toolStatus` and tool renderers for a tiny LOC win.
