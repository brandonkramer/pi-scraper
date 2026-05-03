# Cheerio-ectomy decision note

## Recommendation

Keep Cheerio in the runtime fast/static extraction path for now.

The benchmark-only prototypes show that a direct `htmlparser2` + `css-select` + `domutils` adapter can be materially faster than Cheerio for parse-and-selector work, and `linkedom` remains faster for isolated parsing on large fixtures. The current runtime, however, depends on Cheerio collection semantics deeply enough that a production switch should be a follow-up implementation task with parity tests rather than a same-spike migration.

## Current Cheerio inventory

Runtime Cheerio entry points:

- `src/parse/fast.ts` calls `cheerio.load(html)` for the fast extraction path.
- `src/parse/alternates.ts` calls `cheerio.load(html)` for alternate/agent-readable link discovery.
- `src/brand/extract.ts` calls `cheerio.load(html)` for brand extraction.

Cheerio-dependent parse/brand helpers:

- `src/parse/selectors.ts` — `remove`, selected roots, visible text, outer HTML, root fallback.
- `src/parse/metadata.ts` — meta/title/lang/canonical, headings, links.
- `src/parse/data-islands.ts` — script selection, `type`/`id` attrs, JSON text extraction.
- `src/parse/noise.ts` — main-content candidate selection, `.find("a")`, link-density scoring, `.first()`.
- `src/parse/recovery.ts` — hero/announcement/footer recovery selectors.
- `src/brand/assets.ts` — icons, manifests, OG/Twitter images, logo candidates.
- `src/brand/extract.ts` — meta maps, inline style maps, theme colors, style text, JSON-LD entities.

Extraction-adjacent modules under `src/extract/verticals/` are API/feed oriented and do not depend on Cheerio.

## Smallest adapter surface observed

A production adapter would need more than raw `querySelectorAll`:

- `load(html)`
- `select(selector, root?)`
- `wrap(node | nodes)` or equivalent for `$(node)` and `$(dedupeElements(roots))`
- collection helpers: `each`, `map`, `get`, `toArray`, `first`, `length`
- node helpers: `text`, `attr`, `html`/outer HTML, `remove`, `find`
- document helpers: `root`, body fallback
- selector compatibility for current selectors, including Cheerio/jQuery-style `:eq(index)` from main-candidate selectors or a replacement representation that avoids stringifying positional selectors

## Prototype coverage

Added `bench/prototype-dom-adapters.mjs` and `npm run spike:cheerio`.

The spike compares three benchmark-only adapters over all HTML eval fixtures:

- `cheerio` baseline
- `linkedom`
- `htmlparser2+css-select`

The benchmark tests this minimal surface: `load`, `select`, `text`, `attr`, `html`, `remove`, and `root`. It writes reports to ignored `bench/results/cheerio-ectomy-*` files.

Package constraint: `htmlparser2`, `css-select`, and `domutils` are currently available transitively through Cheerio. A production switch must add explicit direct dependencies before runtime source imports those packages.

## Benchmark results

Environment: Node `v22.20.0`, warmup 3, repeats 20 unless noted.

### Adapter prototype (`npm run spike:cheerio -- --warmup=3 --repeats=20`)

Representative median timings:

| Fixture                       |      Cheerio parse |     Linkedom parse |  htmlparser2 parse |      Cheerio survey |     Linkedom survey |  htmlparser2 survey | Quality deltas                                                                 |
| ----------------------------- | -----------------: | -----------------: | -----------------: | ------------------: | ------------------: | ------------------: | ------------------------------------------------------------------------------ |
| `large-docs-page.html`        |            7.62 ms |            4.33 ms |            1.20 ms |            15.45 ms |            12.65 ms |             8.58 ms | text/headings/links/JSON-LD/logos matched; htmlparser2 outer HTML +2,398 chars |
| `large-spa-data-islands.html` |            2.91 ms |            0.15 ms |            0.14 ms |             3.40 ms |             0.22 ms |             0.20 ms | text/headings/links/JSON-LD/logos matched                                      |
| small fixtures                | 0.03–0.36 ms parse | 0.01–0.30 ms parse | 0.01–0.07 ms parse | 0.14–0.50 ms survey | 0.06–0.41 ms survey | 0.05–0.28 ms survey | text/headings/links matched; minor outer HTML serialization differences        |

Observed quality deltas in the prototype were mostly zero for text length, headings, links, JSON-LD counts, and logo-candidate counts. Serialization differs: linkedom usually produced body outer HTML two chars shorter than Cheerio, while htmlparser2 produced larger differences on malformed/repeated large docs fixtures.

### Existing linkedom parse profile (`npm run profile:linkedom`)

| Fixture                       | `linkedom.parseHTML` median | `cheerio.load` median | `linkedom+query` median | `cheerio+query` median |
| ----------------------------- | --------------------------: | --------------------: | ----------------------: | ---------------------: |
| `large-docs-page.html`        |                     4.02 ms |               7.64 ms |                 4.94 ms |                8.01 ms |
| `large-spa-data-islands.html` |                     0.15 ms |               2.49 ms |                 0.16 ms |                3.20 ms |

### Existing extractor comparison (`npm run compare:extract`)

Aggregate performance:

| Tool                   | Cases | Median of medians | Mean of means | Best median cases |
| ---------------------- | ----: | ----------------: | ------------: | ----------------: |
| `readability+linkedom` |     9 |           4.88 ms |       5.49 ms |                 3 |
| `pi-scraper(fast)`     |     9 |           5.10 ms |       5.29 ms |                 6 |
| `defuddle`             |     9 |          22.05 ms |      22.92 ms |                 0 |

Quality notes:

- `pi-scraper(fast)` preserved SPA data-island text where `readability+linkedom` and Defuddle returned zero text.
- `pi-scraper(fast)` preserved many docs links (`224`) on `large-docs-page.html`; `readability+linkedom` returned `0`, and Defuddle returned `220`.
- Readability extracted more article/product text on some rich fixtures, but it is already available as the separate readable mode and is not a drop-in fast-path parser replacement.

## Migration effort and risks

A safe migration would require:

1. Add direct runtime dependencies for any lower-level parser packages used by source files.
2. Introduce a tiny internal parse adapter under `src/parse/` and port one narrow caller at a time.
3. Replace Cheerio-specific positional selector strings such as `:eq(index)` with node references or adapter-level `first`/index APIs.
4. Add parity tests for metadata, links, headings, data islands, include/exclude selectors, image removal, main-content ranking, recovery, alternates, and brand assets.
5. Compare serialized HTML/text output on malformed/noisy fixtures, because outer HTML differs even when text/link counts match.
6. Re-run `npm run bench`, `npm run compare:extract`, `npm run compare:serialize`, and tool smoke tests before removing Cheerio.

Primary risks:

- Selector behavior differences for Cheerio/jQuery extensions and malformed HTML.
- Whitespace/textContent differences that change markdown, token count, or signal thresholds.
- Outer HTML serialization differences that affect downstream Turndown output.
- Hidden coupling to Cheerio collection methods (`map().get()`, `toArray()`, `first()`, `find()`, `root()`).
- Declaring transitive parser packages as runtime dependencies if lower-level imports move from benchmark-only code into `src/`.

## Follow-up plan if revisited

If parser performance becomes a top bottleneck again, implement a dedicated follow-up task:

1. Add direct dev/prod dependency declarations for chosen parser primitives.
2. Create `src/parse/dom-adapter.ts` with the observed minimal surface.
3. Port `src/parse/alternates.ts` first because it has the smallest Cheerio surface.
4. Port `src/brand/assets.ts` or metadata extraction next with focused parity tests.
5. Port `extractFastPage` last, after main-content and recovery parity tests are in place.
6. Only remove Cheerio once all runtime callers are migrated and eval/compare outputs remain equivalent or better.

Current conclusion: keep Cheerio, keep the prototype benchmark, and use it as evidence for a later measured migration rather than changing production extraction behavior now.
