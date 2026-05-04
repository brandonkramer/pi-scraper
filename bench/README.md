# pi-scraper Benchmarks

Benchmark/eval scaffolding for source checkouts. This directory is dev-only and is not included in the npm package allowlist.

Layout:

- `bench.mjs` — primary fixture-backed extraction eval entrypoint used by `npm run bench`.
- `extract/` — extraction quality/performance comparisons.
- `serialize/` — HTML→Markdown/text serializer comparisons and profiles.
- `parse/` — parser-specific profiles that are not part of the DOM migration gate.
- `dom/` — DOM parser migration evidence: speed spike, quality comparison, memory comparison, diff stability, in-memory batch timing, real-world capture, and the Cheerio-ectomy decision note.
- `tools/` — cold-process Pi tool registration benchmark.
- `harness/` — shared build, timing, reporting, and signal-evaluation code.
- `scripts/` — release-validation smoke scripts such as packed-tarball install checks.
- `results/` and `.eval-runner-build` / `.tool-registration-build` — generated locally and ignored by git.

## Extraction eval runner

Run the fixture-backed extraction eval and benchmark with:

```bash
npm run bench
# or
node bench/bench.mjs eval/corpus.json [--warmup=N] [--repeats=N]
```

`--warmup` (default `3`) and `--repeats` (default `20`) control the per-fixture timing loop on top of the single-shot signal evaluation.

The runner reads `eval/corpus.json`, looks for offline fixtures in `eval/fixtures/<case-id>.html` or `.pdf`, drives each available HTML fixture through `scrapeUrl(mode: "fast")` with an in-memory fixture-backed HTTP client (no network), and writes:

- `bench/results/<ISO-timestamp>.json` — machine-readable report with environment metadata, metrics, signals, verdicts, and per-case `perf` distribution stats (samples, min, median, mean, p95, max, stddev).
- `bench/results/latest.md` — compact human-readable summary with a Signals table and a Performance table. The same markdown summary is printed to stdout.

Exit codes:

- `0` — every non-skipped case passed its required offline signals.
- `1` — at least one non-skipped case failed, or the runner crashed.

Cases without fixtures are reported as `skipped: "no_fixture"` and do not fail the run.

## Adding a case or fixture

1. Add or update an entry in `eval/corpus.json` with an `id`, `category`, `goal`, and `expectedSignals`.
2. Add a tiny synthetic fixture at `eval/fixtures/<id>.html` (or `.pdf`) when the signal can be checked offline. Other extensions are not auto-discovered.
3. Keep fixtures original and minimal. Do not copy scraped third-party pages.
4. Keep browser/provider-backed checks separate from the local-first baseline.

Do not add benchmark fixtures that require credentials, bypass protected sites, use live network, or depend on private-network or personal/local paths.

## Comparison benchmarks

Head-to-head dev-only benchmarks against external libraries. They run against the same `eval/fixtures/*.html` files and use the same warmup/repeats stats helper as the eval runner.

```bash
npm run compare:extract       # pi-scraper(fast) vs Readability+linkedom vs defuddle
npm run compare:serialize     # pi-scraper(htmlToMarkdown) vs Turndown, Turndown+GFM, node-html-markdown, html-to-text
npm run compare:dom           # Cheerio vs htmlparser2 stack quality/timing parity, including selector scenarios
npm run compare:dom:memory    # Cheerio vs htmlparser2 stack post-GC memory deltas
npm run compare:dom:diff      # normalized text/markdown diff-stability signal
npm run compare:dom:batch     # in-memory DOM adapter batch timing
npm run capture:dom:real      # opt-in capture of public real-world snapshots under ignored bench/results/
```

Both accept `--warmup=N` and `--repeats=N` (defaults: 3 / 20 for extract, 3 / 50 for serialize). The serializer comparison includes simple pages plus richer synthetic docs/product/article fixtures with lists, code blocks, tables, links, and image/figure markup, plus 10× and 50× repeated-document stress cases.

Reports are written to `bench/results/`:

- `compare-extract-<ISO>.json` + `compare-extract-latest.md` — Quality (title found, text length, heading/link count) and Performance (min/median/mean/p95/max/stddev ms) per fixture.
- `compare-serialize-<ISO>.json` + `compare-serialize-latest.md` — same shape, isolated to the HTML→Markdown/text step on cleaned HTML produced by `extractFastPage`. Quality metrics include an aggregate structure-preservation score plus character count, heading/link/list markers, code fences, table rows, and leaked HTML tags.
- `dom-adapter-quality-<ISO>.json` + `dom-adapter-quality-latest.md` — compares Cheerio with the direct `htmlparser2`/`domhandler`/`css-select`/`dom-serializer` stack for metadata, headings, links, meaningful data islands, text similarity, markdown similarity, informational HTML serialization deltas, and per-fixture timing. HTML serialization deltas are expected because serializers differ; they do not affect pass/review status when text, markdown, metadata, and data islands are stable.
- `dom-adapter-memory-<ISO>.json` + `dom-adapter-memory-latest.md` — compares post-GC heap/RSS deltas for the same DOM adapter surface; run with `node --expose-gc` via `npm run compare:dom:memory`.
- `dom-adapter-diff-stability-<ISO>.json` + `dom-adapter-diff-stability-latest.md` — compares normalized text and markdown hashes/similarity to flag likely snapshot-diff noise from parser changes.
- `dom-adapter-batch-timing-<ISO>.json` + `dom-adapter-batch-timing-latest.md` — preloads fixture HTML and compares Cheerio with the direct htmlparser2 stack over the same DOM adapter batch surface. This intentionally excludes network, SSRF guards, `scrapeUrl`, and markdown serialization; end-to-end parser-switch timing should be added only after a runtime adapter switch exists.

Raw Turndown is configured with the same base options as pi-scraper's wrapper (atx headings, fenced code) so the heading-count quality metric isn't skewed by Turndown's setext default. The `turndown+gfm` comparator mirrors pi-scraper's runtime table/task-list/strikethrough support.

## Profiling and cold-start benchmarks

```bash
npm run profile:linkedom              # large fixtures only, default warmup 5 / repeats 50
npm run profile:linkedom -- --fixtures=large-docs-page,large-spa-data-islands
npm run profile:markdown              # Turndown/GFM/stable-link profiling, default warmup 5 / repeats 50
npm run spike:cheerio                 # Cheerio/linkedom/htmlparser2 adapter spike, default warmup 3 / repeats 20
npm run bench:tool-registration       # cold Node process import + Pi registration, default warmup 3 / repeats 20
```

`profile:linkedom` writes `linkedom-parse-<ISO>.json` and `linkedom-parse-latest.md`; it isolates `linkedom.parseHTML()` and `parseHTML()+querySelectorAll()` costs on large HTML fixtures, with `cheerio.load()` comparators for context.

`profile:markdown` writes `turndown-rules-<ISO>.json` and `turndown-rules-latest.md`; it compares base Turndown, normalization, GFM, stable-link rules, image removal, and the runtime `htmlToMarkdown` wrapper on the cleaned HTML that `extractFastPage` returns.

`spike:cheerio` runs `bench/dom/prototype-adapters.mjs`, writes `cheerio-ectomy-<ISO>.json` and `cheerio-ectomy-latest.md`, and remains benchmark-only evidence for parser migration decisions. The lower-level parser prototype uses direct dev dependencies (`htmlparser2`, `domhandler`, `css-select`, `dom-serializer`, and `domutils`); production source must promote them to runtime dependencies before using those packages.

`bench:tool-registration` compiles `src/index.ts` into `bench/.tool-registration-build/`, then measures a fresh Node process importing the compiled extension and registering tools, commands, and session handlers against a stub Pi registrar. Reports are written to `tool-registration-<ISO>.json` and `tool-registration-latest.md`.

The extra extractors/serializers (`defuddle`, `node-html-markdown`, `html-to-text`) are `devDependencies` only and are excluded from the published npm tarball.

## Release-validation smoke scripts

```bash
npm run smoke:install              # packs and installs the tarball in a temp project, then verifies tool registration
PI_SCRAPER_LIVE=1 npm run smoke:live       # opt-in public-network scrape/map smoke
PI_SCRAPER_BROWSER=1 npm run smoke:browser # opt-in Playwright browser-mode smoke
npm run audit:strict               # production dependency audit gate
npm run lint:workflows             # requires Docker; runs actionlint against GitHub workflow YAML
```

`smoke:live` and `smoke:browser` are intentionally opt-in so default tests remain offline and do not require browser binaries.
