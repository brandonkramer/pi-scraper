# pi-scraper benchmarks

Benchmarks are development-only checks for extraction quality, parser/runtime tradeoffs, serialization cost, and package/tool smoke behavior. They are not shipped in the npm package.

## Layout

| Path               | Purpose                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------ |
| `bench/bench.mjs`  | Primary eval-corpus entrypoint used by `npm run bench`; thin wrapper around `bench/bin/bench.mjs`.           |
| `bench/bin/`       | CLI entrypoints.                                                                                             |
| `bench/lib/`       | Shared infrastructure: CLI args, stats, build pipeline, fixture loading, compare runner, and result writing. |
| `bench/suites/`    | Measurement scripts grouped by subject.                                                                      |
| `bench/fixtures/`  | Tracked input snapshots for real-world DOM adapter comparisons.                                              |
| `bench/results/`   | Generated summaries and ignored timestamped history, mirroring `suites/`.                                    |
| `bench/decisions/` | Decision records backed by benchmark evidence.                                                               |
| `bench/.build/`    | Ignored build caches used by bench scripts.                                                                  |

## Common commands

| Command                           | Measures                                              | Output                                       |
| --------------------------------- | ----------------------------------------------------- | -------------------------------------------- |
| `npm run bench`                   | Offline extraction corpus quality and timing.         | `bench/results/eval-corpus/`                 |
| `npm run compare:dom`             | DOM adapter quality and timing against fixtures.      | `bench/results/dom-adapters/quality/`        |
| `npm run compare:dom:batch`       | In-memory DOM adapter batch timing.                   | `bench/results/dom-adapters/timing/`         |
| `npm run compare:dom:memory`      | DOM adapter memory deltas.                            | `bench/results/dom-adapters/memory/`         |
| `npm run compare:dom:diff`        | Text/markdown diff stability across adapters.         | `bench/results/dom-adapters/diff-stability/` |
| `npm run spike:cheerio`           | Historical Cheerio-ectomy adapter prototype evidence. | `bench/results/dom-adapters/prototype/`      |
| `npm run compare:extract`         | pi-scraper vs known extractor libraries.              | `bench/results/extractors/compare/`          |
| `npm run compare:serialize`       | HTML-to-markdown serializer comparison.               | `bench/results/serializers/compare/`         |
| `npm run profile:linkedom`        | linkedom parse/query profile.                         | `bench/results/parsers/linkedom/`            |
| `npm run profile:markdown`        | Turndown rule profile.                                | `bench/results/serializers/turndown-rules/`  |
| `npm run bench:tool-registration` | Cold extension import and Pi registration time.       | `bench/results/tool-registration/`           |
| `npm run smoke:install`           | Packed tarball install smoke.                         | No bench result by default.                  |

## Results

Each suite writes:

- `latest.md` — tracked human-readable summary for the latest run when intentionally committed.
- `history/<timestamp>.json` — ignored machine-readable history for local comparison.

`bench/results/README.md` describes the result hierarchy and rotation policy.

## Fixtures

`npm run capture:dom:real` captures public real-world pages into `bench/fixtures/`. Those fixtures are inputs, not results, so they live outside `bench/results/`.

## Adding a benchmark

1. Pick or create a folder under `bench/suites/<subject>/`.
2. Import reusable helpers from `bench/lib/`.
3. Write outputs under `bench/results/<subject>/<kind>/` using `writeSuiteReport()`.
4. Add or update the suite README.
5. Keep generated JSON under `history/` so it stays ignored by git.
