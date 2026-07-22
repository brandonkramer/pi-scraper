# Pi 0.81 modernization — requirements

> **Spec version:** `1.0.0`
> **Project:** [`project.toml`](./project.toml)
> **Goal:** [`GOAL.md`](./GOAL.md)
> **Design:** [`PLAN.md`](./PLAN.md)
> **Tasks:** [`TASKS.md`](./TASKS.md)
> **Proof:** [`LOOP.md`](./LOOP.md)

`MUST` and `MUST NOT` are normative. Requirement IDs are stable.

## Functional requirements

### REQ-PI-001 — Current Pi model runtime

- **Statement:** WHEN model-backed extraction runs, the extension MUST use APIs supported by Pi 0.81 without relying on the temporary root-import compatibility alias.
- **Current behavior:** The adapter dynamically expects the pre-0.80 `pi-ai` globals and duck-types `ctx.model` as a completion client.
- **Expected behavior:** Explicit provider/model configuration creates a current Pi model runtime, forwards cancellation, and returns text only for successful model responses.
- **Unchanged behavior:** External adapters registered through the extension event remain supported.
- **Failure/recovery:** Missing configuration, provider errors, and cancellation return structured adapter failures without leaking or continuing work.
- **Verification:** deterministic unit tests and TypeScript compilation

### REQ-LIFECYCLE-001 — Pi-owned lifecycle

- **Statement:** WHEN a Pi session starts or shuts down, the extension MUST start and stop its resources through Pi lifecycle events.
- **Current behavior:** Download cleanup begins in the extension factory and the extension installs global process-exit handlers.
- **Expected behavior:** Startup work is deferred to `session_start`; shutdown is idempotent under `session_shutdown`; no extension-owned process exit occurs.
- **Unchanged behavior:** Browser, database, and download cleanup still occur.
- **Failure/recovery:** Repeated shutdown notifications are harmless.
- **Verification:** deterministic lifecycle tests and structural search

### REQ-TRUST-001 — Trusted project manifests

- **Statement:** WHEN vertical manifests are resolved, the extension MUST use the session working directory and MUST include project-local manifests only for a trusted project.
- **Current behavior:** Resolution uses `process.cwd()` and caches only an include-project boolean.
- **Expected behavior:** The registry is scoped by cwd and trust and is invalidated at session boundaries or explicit reload.
- **Unchanged behavior:** Built-in and user manifests continue to load.
- **Failure/recovery:** An untrusted or changed project cannot reuse another project's cached manifests.
- **Verification:** deterministic unit tests with multiple cwd/trust combinations

### REQ-TYPES-001 — Native Pi contracts

- **Statement:** WHEN tools and health notices are registered, the implementation MUST type-check against Pi's 0.81 native extension contracts without double-casting through `unknown`.
- **Current behavior:** Custom mirrored interfaces and casts hide API drift; health warnings target non-Pi registrar methods.
- **Expected behavior:** Tool definitions satisfy Pi's current type, optional abort signals are safe, and UI notifications use the session context.
- **Unchanged behavior:** Tool names, parameters, result shape, and quiet healthy startup remain stable.
- **Failure/recovery:** A future incompatible Pi signature causes a compile-time error.
- **Verification:** TypeScript compilation and focused tests

### REQ-CI-001 — Reproducible cross-platform checks

- **Statement:** WHEN repository checks run on Windows or Linux, the scripts MUST select the intended tests and use one declared tool-contract budget.
- **Current behavior:** Selection test paths are stale, eval scripts use POSIX-only environment syntax, and contract budgets disagree.
- **Expected behavior:** Scripts are cross-platform, CI runs typecheck/tests/lint/format and skill-document checks, and README/package metadata agree on Pi support.
- **Unchanged behavior:** Live/browser smoke tests remain opt-in.
- **Failure/recovery:** Markdown-only tool guidance changes still execute the lightweight contract checks.
- **Verification:** script tests, workflow lint, package scripts, and static documentation assertions

### REQ-LOAD-001 — Deferred specialized tools

- **Statement:** WHERE the host supports Pi dynamic tool activation, the extension MUST keep all seven tools registered while initially activating only the common tools and a discovery path for specialized tools.
- **Current behavior:** Every tool contract is active for every turn.
- **Expected behavior:** Common scraping/extraction stays one call away; specialized tools can be activated additively and are described by a lightweight loader.
- **Unchanged behavior:** Hosts without dynamic activation retain all seven existing tools.
- **Failure/recovery:** Unknown tool requests do not deactivate existing tools or hide the loader.
- **Verification:** deterministic registration/activation tests and selection fixtures

## Quality requirements

### NFR-CONTRACT-001 — Contract reduction without selection regression

- **Statement:** The default dynamic active set MUST reduce measured tool-description characters by at least 35% while all deterministic selection fixtures remain passing.
- **Threshold:** Compare the registered-all baseline with the dynamic initial active set using one shared measurement helper; reduction >=35%, fixture failures = 0.
- **Verification:** deterministic measurement and fixture suite

## Invariants

### INV-BOUNDARY-001 — Host ownership

- **Statement:** The implementation MUST NOT call `process.exit`, install process signal handlers, or read untrusted project manifests from extension startup.
- **Verification:** structural test and focused lifecycle integration test

## Compatibility

### COMPAT-TOOLS-001 — Existing tool capability

- **Statement:** WHERE dynamic activation is unavailable, the system MUST preserve registration and availability of the existing seven tools.
- **Verification:** compatibility registration test

## Traceability

| Requirement         | Plan slice | Tasks                  | Cases                 | Gates              |
| ------------------- | ---------- | ---------------------- | --------------------- | ------------------ |
| `REQ-PI-001`        | MIG1       | `MIG1-T01`             | `CASE-PI-MODEL`       | `GATE-CORRECTNESS` |
| `REQ-LIFECYCLE-001` | MIG2       | `MIG2-T01`             | `CASE-LIFECYCLE`      | `GATE-CORRECTNESS` |
| `REQ-TRUST-001`     | MIG2       | `MIG2-T02`             | `CASE-TRUST`          | `GATE-SECURITY`    |
| `REQ-TYPES-001`     | MIG3       | `MIG3-T01`             | `CASE-TYPES`          | `GATE-CORRECTNESS` |
| `REQ-CI-001`        | MIG4       | `MIG4-T01`             | `CASE-CROSS-PLATFORM` | `GATE-COMPAT`      |
| `REQ-LOAD-001`      | MIG5       | `MIG5-T01`             | `CASE-DEFERRED-TOOLS` | `GATE-CORRECTNESS` |
| `NFR-CONTRACT-001`  | MIG5       | `MIG5-T02`             | `CASE-CONTRACT-SIZE`  | `GATE-QUALITY`     |
| `INV-BOUNDARY-001`  | MIG2       | `MIG2-T01`, `MIG2-T02` | `CASE-HOST-BOUNDARY`  | `GATE-SECURITY`    |
| `COMPAT-TOOLS-001`  | MIG5       | `MIG5-T01`             | `CASE-LEGACY-HOST`    | `GATE-COMPAT`      |
