# Pi 0.81 modernization — research ledger

> **Last consolidated:** 2026-07-21
> **Project:** [`project.toml`](./project.toml)
> **Requirements:** [`SPEC.md`](./SPEC.md)
> **Selected design:** [`PLAN.md`](./PLAN.md)

## Evidence rules

Entries are labeled **Observed**, **Inferred**, **Proposed**, or **Unknown** and
name their source and implication. Verification results are appended at task
boundaries rather than inferred from code presence.

## Prior research

### 2026-07-21 — Pi 0.81 API and repository audit

- **Status:** Observed
- **Source:** repository revision `d9d349d`; Pi `v0.81.1` changelog, AI migration guide, and extension documentation
- **Observation:** Pi 0.80 replaced the old AI global API with model/runtime objects; the current 0.81 line supports `session_shutdown`, project trust, full provider extensions, and dynamic active tools. The repository still uses pre-0.80 assumptions, global process handlers, untrusted `process.cwd()` manifest loading, and an always-active seven-tool contract.
- **Implication:** A lockstep dependency migration must update behavior and types before optimization.
- **Requirement/plan impact:** all requirements; MIG1 through MIG5
- **Follow-up:** confirm exact installed 0.81.1 declarations after dependency resolution.

### 2026-07-21 — Latest release moved during planning

- **Status:** Observed
- **Source:** Bun registry metadata and official Git tag `v0.81.1` (`20be4b1`)
- **Observation:** Registry resolution reports all lockstep Pi packages at `0.81.1`, released 2026-07-21, newer than the cached npm page's `0.80.10` listing.
- **Implication:** The target is frozen at 0.81.1 before product treatment begins.
- **Requirement/plan impact:** `REQ-PI-001`, `REQ-TYPES-001`; MIG1 and MIG3
- **Follow-up:** inspect 0.81.1 declarations and changelog during MIG1.

### 2026-07-21 — Verification drift

- **Status:** Observed
- **Source:** `package.json`, `.github/workflows/ci.yml`, `README.md`, `eval/tool-selection/config.mjs`, and tool contract tests
- **Observation:** Selection paths are stale, Windows-incompatible eval environment assignment is embedded in package scripts, Markdown is excluded from CI, and three prompt-budget values disagree.
- **Implication:** Baseline verification can give false confidence and cannot yet grade deferred loading.
- **Requirement/plan impact:** `REQ-CI-001`, `NFR-CONTRACT-001`; MIG4 before the final MIG5 gate
- **Follow-up:** centralize contract statistics and prove a negative fixture fails.

## Evidence entries

### 2026-07-21 — Pi 0.81 runtime and dependency result

- **Status:** Observed / PASS
- **Source:** installed declarations and registry metadata after fresh Bun lock resolution
- **Observation:** `@earendil-works/pi-ai`, `pi-coding-agent`, and `pi-tui` all resolve to `0.81.1`; Pi core modules are declared as host-supplied `"*"` peers per the 0.81 package contract; a real `ModelRuntime.create()` smoke resolves an intentionally missing model without an API request.
- **Command:** `bun pm view <package> version`; `bun -e "...tryCreatePiAiAdapter..."`
- **Implication:** `REQ-PI-001` and `REQ-TYPES-001` use the current lockstep Pi contracts.

### 2026-07-21 — Focused correctness, security, and compatibility gates

- **Status:** Observed / PASS
- **Source:** dirty implementation worktree
- **Observation:** 121 focused tests passed with one opt-in live test skipped; 15 contract/selection/documentation tests and seven tool smoke cases passed.
- **Command:** focused `vitest run` over config, health, lifecycle, trust, model, registration, and extraction; `bun run test:selection`; `bun run test:tools`
- **Additional gates:** `bun run typecheck`, scoped `bun run format:check`, `bun run lint` (zero errors; baseline warnings remain), `bun run lint:workflows`, frozen-lock install, and package dry-run passed.
- **Security:** `bun audit --prod --audit-level=high` reported no vulnerabilities after resolving patched `undici` and `tar` lines.
- **Implication:** `GATE-CORRECTNESS`, `GATE-SECURITY`, and `GATE-COMPAT` pass for the requested surfaces.

### 2026-07-21 — Deferred contract treatment

- **Status:** Observed / PASS; retain treatment
- **Source:** deterministic `bun run eval:selection`
- **Observation:** all-tools contract = 1,489 tokens; initial `web_scrape + web_extract + web_tools` contract = 724 tokens; reduction = 51.4% against the frozen 35% threshold.
- **Selection:** positive exact tool accuracy 100%, negative no-tool precision 100%, invocation exact-arg accuracy 100% over approximately 38 scorable fixtures, critical confusions 0.
- **Implication:** `GATE-QUALITY` passes and deferred loading remains enabled on capable Pi hosts.

### 2026-07-21 — Full Windows suite boundary

- **Status:** Observed / INCONCLUSIVE for the pre-existing full Windows suite; requested-surface tests PASS
- **Source:** `bun run test` on Windows
- **Observation:** 892 tests passed and four skipped; 20 failures remained in eight unchanged Windows-sensitive files. They are POSIX path/mode assertions, a drive-path URL fixture, and SQLite handle/lock cleanup cases. The one modernization regression found during the first run was corrected and its focused test passes.
- **Implication:** Linux continues to own the full CI unit run; the new Windows job intentionally runs typecheck, selection/contracts, and tool smoke. No full-suite pass is claimed for this local Windows host.
