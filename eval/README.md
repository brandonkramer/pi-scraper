# pi-scraper Evals

Dev-only eval suites for release checks. Intentionally outside the npm `files`
allowlist. `eval/` holds tracked inputs + scoring logic; `bench/` holds
gitignored outputs (`results/<suite>/latest.{json,md}`) and the contract build
(`.build/<suite>/`).

## Suites

| Suite | Measures | Runner |
| --- | --- | --- |
| [`tool-selection/`](tool-selection/README.md) | Model routing: does the model pick the right web tool (selection) and the right discriminator args (invocation), within a contract-token budget. | `npm run eval:selection` |
| [`extraction-quality/`](extraction-quality/README.md) | Extraction/scrape fidelity across representative pages (articles, docs, SPAs, PDFs, bot-block). Corpus + manifest; runner is future work. | (manifest only today) |

## Two-tier gate model

Eval signal is split by determinism:

- **Deterministic gates** — run in vitest/CI on every change. No model, no
  network: the contract token budget (`src/tools/__tests__/tool-contract.test.ts`),
  the fixture invariants (`src/tools/__tests__/tool-selection-fixtures.test.ts`),
  and the pure scorer (`eval/tool-selection/score.test.mjs`). Bundled as
  `npm run test:selection`.
- **Model gates** — run via the node runner locally/nightly, not in CI: routing
  selection + invocation accuracy against a live model
  (`npm run eval:selection:pi`). Non-deterministic, so averaged over `--runs`
  and gated on the mean.

## Each suite is the same shape

`run.mjs` (orchestrate) + `config.mjs` (thresholds/keys as data) + `score.mjs`
(pure data→report, unit-tested) + `fixtures/` (split by tool/concern, globbed) +
`README.md`. A new suite copies this shape rather than inventing one. Shared
plumbing (`_lib/`) is introduced only once a second runner needs it — not before.
