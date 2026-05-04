# Bench results

Generated benchmark output mirrors `bench/suites/`.

| Path pattern                              | Meaning                                                                            |
| ----------------------------------------- | ---------------------------------------------------------------------------------- |
| `<suite>/<kind>/latest.md`                | Latest human-readable report for a suite kind.                                     |
| `<suite>/<kind>/history/<timestamp>.json` | Ignored machine-readable history.                                                  |
| `<suite>/latest.md`                       | Latest report for single-kind suites such as `eval-corpus` or `tool-registration`. |
| `<suite>/history/<timestamp>.json`        | Ignored machine-readable history for single-kind suites.                           |

`history/` contents are ignored by git except `.gitkeep`. Commit `latest.md` only when a benchmark report is intentionally part of a change review.
