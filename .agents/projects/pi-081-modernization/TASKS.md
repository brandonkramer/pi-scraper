# Pi 0.81 modernization — executable tasks

> **Current state:** [`project.toml`](./project.toml)
> **Requirements:** [`SPEC.md`](./SPEC.md)
> **Design:** [`PLAN.md`](./PLAN.md)
> **Proof:** [`LOOP.md`](./LOOP.md)

`project.toml` is authoritative for the current task. Tasks become done only
after their named checks pass and evidence is recorded.

## MIG1

### [x] MIG1-T01 — Migrate model execution to Pi 0.81

- **Status:** done
- **Requirements:** `REQ-PI-001`
- **Plan:** `PLAN.md` § Dependency order / MIG1
- **Depends on:** none
- **Blocked by:** none
- **Surfaces:** package metadata/lock, model adapters, adapter config, focused tests
- **Implementation:** Resolve 0.81.1 declarations; replace old globals and impossible host-model duck typing; forward aborts and map error stop reasons.
- **Verification:** focused model/config tests and `bun run typecheck`
- **Evidence tiers:** task check (<2 min); project gate only at completion
- **Loop evidence:** `CASE-PI-MODEL`; `GATE-CORRECTNESS`
- **Evidence:** PASS — all three Pi packages resolve to 0.81.1; nine model-runtime tests, real runtime initialization smoke, config tests, and typecheck pass.
- **Handoff:** Advance manifest to `MIG2-T01` after evidence is recorded.

## MIG2

### [x] MIG2-T01 — Move startup and shutdown to Pi events

- **Status:** done
- **Requirements:** `REQ-LIFECYCLE-001`, `INV-BOUNDARY-001`
- **Plan:** `PLAN.md` § Dependency order / MIG2
- **Depends on:** `MIG1-T01`
- **Blocked by:** none
- **Surfaces:** extension entrypoint, registration, session lifecycle tests
- **Implementation:** Defer startup cleanup and use idempotent `session_shutdown`; remove process handlers and process exit.
- **Verification:** focused lifecycle tests plus structural search
- **Evidence tiers:** task check (<2 min); phase gate at MIG2 completion
- **Loop evidence:** `CASE-LIFECYCLE`, `CASE-HOST-BOUNDARY`; `GATE-CORRECTNESS`, `GATE-SECURITY`
- **Evidence:** PASS — five lifecycle cases cover deferred startup, configured adapter registration, double shutdown, warning recovery, and absence of process handlers/exits.
- **Handoff:** Advance manifest to `MIG2-T02`.

### [x] MIG2-T02 — Scope project manifests by cwd and trust

- **Status:** done
- **Requirements:** `REQ-TRUST-001`, `INV-BOUNDARY-001`
- **Plan:** `PLAN.md` § Dependency order / MIG2
- **Depends on:** `MIG2-T01`
- **Blocked by:** none
- **Surfaces:** vertical loader/registry, session integration, tests
- **Implementation:** Pass explicit cwd/trust, key or invalidate cache correctly, and preserve user/builtin sources.
- **Verification:** focused vertical registry and registration tests
- **Evidence tiers:** task check (<2 min); phase gate (<3 min)
- **Loop evidence:** `CASE-TRUST`, `CASE-HOST-BOUNDARY`; `GATE-SECURITY`
- **Evidence:** PASS — untrusted, distinct-cwd, and explicit cache-invalidation cases pass; project loading defaults fail closed without trust.
- **Handoff:** Advance manifest to `MIG3-T01`.

## MIG3

### [x] MIG3-T01 — Adopt native Pi tool and health types

- **Status:** done
- **Requirements:** `REQ-TYPES-001`
- **Plan:** `PLAN.md` § Dependency order / MIG3
- **Depends on:** `MIG2-T02`
- **Blocked by:** none
- **Surfaces:** tool definition/registration, health, tests
- **Implementation:** Remove double casts, handle optional signals, notify through session UI, and eliminate avoidable `any`.
- **Verification:** focused tool/health tests and `bun run typecheck`
- **Evidence tiers:** task check (<2 min)
- **Loop evidence:** `CASE-TYPES`; `GATE-CORRECTNESS`
- **Evidence:** PASS — native ToolDefinition adaptation, real command/model context, optional signal normalization, health UI notification, TUI theme typing, and TypeScript compilation pass.
- **Handoff:** Advance manifest to `MIG4-T01`.

## MIG4

### [x] MIG4-T01 — Make repository checks coherent and cross-platform

- **Status:** done
- **Requirements:** `REQ-CI-001`
- **Plan:** `PLAN.md` § Dependency order / MIG4
- **Depends on:** `MIG3-T01`
- **Blocked by:** none
- **Surfaces:** package scripts, eval harness, CI, README, skill contract tests
- **Implementation:** Correct paths, centralize the budget, replace shell-only env syntax, add lint/format and Markdown contract coverage, align supported Pi docs.
- **Verification:** selection suite, workflow lint, package checks, static docs tests
- **Evidence tiers:** task check (<3 min); project gate at completion
- **Loop evidence:** `CASE-CROSS-PLATFORM`; `GATE-COMPAT`
- **Evidence:** PASS — frozen Bun install, typecheck, scoped format, lint, actionlint, docs/selection tests, clean strict audit, and 301-file package dry-run pass; CI declares Linux Node 22/24 and Windows smoke jobs.
- **Handoff:** Advance manifest to `MIG5-T01`.

## MIG5

### [x] MIG5-T01 — Add compatible deferred tool activation

- **Status:** done
- **Requirements:** `REQ-LOAD-001`, `COMPAT-TOOLS-001`
- **Plan:** `PLAN.md` § Dependency order / MIG5
- **Depends on:** `MIG4-T01`
- **Blocked by:** none
- **Surfaces:** tool registration/loader, skill docs, registration and fixture tests
- **Implementation:** Register all capabilities; keep common tools plus discovery active on capable Pi; preserve all-tools fallback.
- **Verification:** focused activation tests and selection fixtures
- **Evidence tiers:** task check (<2 min); phase gate at MIG5 completion
- **Loop evidence:** `CASE-DEFERRED-TOOLS`, `CASE-LEGACY-HOST`; `GATE-CORRECTNESS`, `GATE-COMPAT`
- **Evidence:** PASS — all tools remain registered, capable hosts start with common+loader tools, specialized activation is additive/precise, unknown queries preserve state, and legacy registrars retain seven tools.
- **Handoff:** Run the frozen contract comparison in `MIG5-T02`.

### [x] MIG5-T02 — Benchmark and decide deferred loading

- **Status:** done
- **Requirements:** `NFR-CONTRACT-001`
- **Plan:** `PLAN.md` § Dependency order / MIG5
- **Depends on:** `MIG5-T01`
- **Blocked by:** none
- **Surfaces:** tool contract stats and deterministic selection harness
- **Implementation:** Measure baseline and dynamic active descriptions with the same helper; retain the feature only if frozen gates pass.
- **Verification:** contract/selection tests, full non-live project checks
- **Evidence tiers:** phase and project gates (<10 min)
- **Loop evidence:** `CASE-CONTRACT-SIZE`; `GATE-QUALITY`
- **Evidence:** PASS — deterministic benchmark measures 1,489 full versus 724 initial tokens (51.4% reduction), 100% selection/invocation metrics, and zero critical confusions; treatment retained.
- **Handoff:** Mark complete only after all project gates and final review pass.
