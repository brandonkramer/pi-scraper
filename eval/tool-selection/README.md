# tool-selection eval

Measures how well a model routes prompts to pi-scraper's web tools:

- **Selection** — picks the right tool (or `null` for multi-source/research/
  unrelated prompts). Split into positive accuracy and negative no-tool precision.
- **Invocation** — sets the right discriminator arg (`action`/`task`/`extractor`/
  `format`/`jsonPaths`) once the tool is right. Omitted args are assumed
  tool-inferred and not scored; free-form args (`jsonPaths`) are scored for
  presence, not exact value.
- **Contract cost** — serialized tool contracts must stay under the token budget.

## Layout

- `run.mjs` — orchestrator: load contracts + fixtures, get predictions, score, render, exit-code gate.
- `config.mjs` — thresholds + discriminator/free-form key sets + runs default (data, not code).
- `score.mjs` — pure `predictions → report` + aggregate + gate. No fs/process/network.
- `score.test.mjs` — unit test for the scorer on canned predictions (runs under `npm test`).
- `fixtures/*.json` — prompt cases split by tool (`scrape`/`crawl`/`map`/`batch`/`extract`/`get-result`/`negatives`); the runner globs + concatenates.
- `adapters/` — model providers behind the stdin/stdout hook. See [`adapters/README.md`](adapters/README.md).

## Thresholds (`config.mjs`)

| Gate | Bound |
| --- | --- |
| positive exact tool accuracy | ≥ 90% |
| negative no-tool precision | ≥ 90% |
| invocation exact-arg accuracy | ≥ 90% |
| critical confusions | = 0 |
| contract token estimate | ≤ 1080 |

## Run

```bash
npm run test:selection          # deterministic: token budget + fixture invariants + scorer unit test (CI)
npm run eval:selection          # static baseline (predictions = expected; sanity-checks the harness)
npm run eval:selection:pi       # model gate via the pi adapter (cues on)
npm run eval:selection:contract # model gate, cues OFF — measures contract quality alone
```

Flags / env:

- `--runs N` or `PI_TOOL_SELECTION_RUNS=N` — average N model runs, gate on the
  mean, surface per-fixture flaky selection/invocation. Model mode only.
- `PI_TOOL_SELECTION_NO_CUES=1` — strip routing cues from the prompt so the score
  reflects the contract, not a hand-written cheat-sheet.
- `--predictions <file>` — score a saved predictions JSON instead of calling a model.

Exit code drives gates: `0` = PASS, `1` = FAIL (failing axis printed under
`VERDICT: FAIL`). Full report: `bench/results/tool-selection/latest.{json,md}`.

## Add a fixture

Append to the matching `fixtures/<tool>.json` (or `negatives.json`):

```json
{
  "id": "extract-vertical-npm",
  "prompt": "Get the package metadata for left-pad from npm.",
  "expectedTool": "web_extract",
  "expectedArgs": { "action": "vertical", "extractor": "npm" },
  "rationale": "Known-site typed extraction routes to web_extract vertical.",
  "tags": ["extract", "vertical", "npm", "contrast:web_scrape"]
}
```

`expectedArgs` discriminator keys (`action`/`format`/`extractor`/…) are what the
invocation score checks. The fixture-invariant test (`tool-selection-fixtures.test.ts`)
requires every tool to keep a positive **and** a `contrast:<tool>`-tagged case.
