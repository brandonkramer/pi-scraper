# Autoresearch: duplication-score

## Objective

Reduce duplicated helper logic and repeated workflow shapes in `pi-scraper` while preserving the modular monolith boundaries. The target is deterministic Graphify AST evidence: duplicate function names and functions that call the same helper sets across source files.

## Metrics

- **Primary**: `duplication_score` (unitless, lower is better) — weighted sum of exact duplicate function labels and repeated call-overlap workflows.
- **Secondary**:
  - `duplicate_function_groups`
  - `duplicate_function_nodes`
  - `high_call_overlap_pairs`
  - `medium_call_overlap_pairs`
  - `exact_workflow_groups`
  - `graph_nodes`
  - `graph_edges`

## How to Run

```bash
./bench/autoresearch/duplication.sh
```

The script uses Graphify's deterministic AST extractor over `src/`, prints `METRIC name=value` lines, then runs:

```bash
npm run typecheck
npm test
```

## Files in Scope

- `src/http/client.ts` — default Undici HTTP flow.
- `src/http/fingerprint-adapter.ts` — fingerprint backend HTTP flow.
- `src/http/redirects.ts` and other `src/http/` files — acceptable homes for shared redirect/fetch/error primitives.
- `src/batch/run.ts` — batch scrape job lifecycle.
- `src/crawl/runner.ts` — crawl job lifecycle and host concurrency.
- `src/storage/jobs.ts` — job manifest/progress helpers.
- `src/http/politeness.ts` — concurrency/semaphore primitives.
- `src/tools/*.ts` — only for focused result-shaping consolidation.
- `src/extract/`, `src/parse/` — only if the metric identifies safe helper duplication.

## Off Limits

- Do not change public Pi tool names or stable `web_` prefixes.
- Do not move search/research behavior into `pi-scraper`.
- Do not introduce new runtime dependencies.
- Do not consolidate migration-only code with live storage unless the boundary remains explicit.
- Do not optimize by renaming functions just to game the metric; shared behavior must actually become shared.

## Constraints

- `npm run typecheck` must pass.
- `npm test` must pass.
- Keep files under the 500-line convention cap.
- Prefer small, targeted refactors.
- Preserve SSRF/robots/politeness invariants.
- Run `graphify update .` after accepted source edits before relying on graph answers.

## Current Best Candidates

1. Extract shared redirect runner/body materialization across `src/http/client.ts` and `src/http/fingerprint-adapter.ts`.
2. Extract a shared keyed concurrency/semaphore primitive for `src/http/politeness.ts` and crawl's `HostLimitPool`.
3. Consolidate batch/crawl job counters and manifest updates if a small `ScrapeJobTracker` pays for itself.
4. Add focused result-shaping helpers for repeated tool result workflows only if they reduce real branching, not just names.

## What's Been Tried

- Baseline: 332. Shared redirect-following flow, response materialization, and error conversion across HTTP transports (332→247).
- Replaced crawl's local HostLimitPool with shared KeyedSemaphore (278, net -16.3%).
- Shared scrape-input result shaping and stored trace context across tools (273→247, cumulative -25.6%).
- Shared UnknownRecord + isUnknownRecord type guard (219→205, cumulative -38.3%).
- Shared setupScrapeJob for batch/crawl job setup (193, cumulative -41.9%).
- Shared missingModelResult + toolErrorResult wrappers across model-backed tools (score unchanged at 193).

Remaining score comprises intentionally different-semantics items. At diminishing returns.
