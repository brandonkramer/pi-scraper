# Bench library

Reusable infrastructure for benchmark suites. Measurement scripts live under `bench/suites/`; this folder should not contain benchmark scenarios.

| File                 | Purpose                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------- |
| `build-pipeline.mjs` | Builds selected TypeScript runtime entries into `bench/.build/eval-runner/` and imports them. |
| `cli-args.mjs`       | Small typed CLI flag readers.                                                                 |
| `compare-runner.mjs` | Shared compare-suite runner for extractors and serializers.                                   |
| `fixtures.mjs`       | DOM adapter implementations and HTML fixture loading for bench-only comparisons.              |
| `results.mjs`        | Writes `latest.md` plus ignored JSON history under `bench/results/`.                          |
| `runner.mjs`         | Eval-corpus runner used by `bench/bin/bench.mjs`.                                             |
| `signals.mjs`        | Eval signal scoring and markdown rendering.                                                   |
| `stats.mjs`          | Repeat timing and summary statistics.                                                         |
| `rotate-results.mjs` | Optional local history pruning utility.                                                       |
