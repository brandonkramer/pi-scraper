# DOM Adapter Runtime Switch Decision

## Decision

SWITCH: make the htmlparser2-backed `DomAdapter` the default runtime static parser.

## Evidence

Task 09 ported production static parse and brand extraction modules to `DomAdapter`, so the benchmark and parity checks now apply to the production parser boundary instead of only a benchmark-only adapter surface.

Latest Task 10 validation showed:

- Production eval: `10 passed, 0 skipped, 0 failed`.
- Full unit/tool tests: passing.
- Synthetic DOM quality: all htmlparser2 adapter cases passed against Cheerio baseline.
- Synthetic DOM diff stability: all text and markdown hashes stable.
- In-memory DOM batch timing: htmlparser2 stack was about `4.1x` faster on local fixtures (`23.49ms` Cheerio vs `5.71ms` htmlparser2 median).
- Extractor comparison: `pi-scraper(fast)` became the fastest aggregate extractor after the switch (`3.04ms` median of medians), while preserving data-island quality.
- Memory comparison: htmlparser2 generally had lower heap/RSS p95, with allocator noise on small fixtures.

## Runtime behavior

- `loadDom()` now defaults to htmlparser2.
- Cheerio remains a runtime dependency and fallback backend.
- Set `PI_SCRAPER_DOM_BACKEND=cheerio` to force the Cheerio-backed adapter for rollback or diagnosis.
- HTML serialization deltas remain informational unless they affect normalized text, markdown, metadata, links, data-island recovery, brand signals, or tool-visible results.

## Non-goals preserved

- Cheerio was not removed.
- Public tool/result shapes were not changed.
- Browser/readable/PDF paths were not changed.
- Search/research surfaces were not added.

## Follow-up

Run real-world DOM comparisons when ignored `bench/fixtures` fixtures are present in the local checkout.
