# Pi 0.81 modernization — build and measurement loop

> **Loop version:** `1.0.0` (frozen 2026-07-21)
> **Project:** [`project.toml`](./project.toml)
> **Requirements:** [`SPEC.md`](./SPEC.md)
> **Tasks:** [`TASKS.md`](./TASKS.md)
> **Evidence ledger:** [`RESEARCH.md`](./RESEARCH.md)

Missing required evidence is `INCONCLUSIVE`. Thresholds may not be weakened
after observing treatment output without a loop-version change.

## Frozen scenarios

| Case                  | Requirements        | Setup/action                                                                               | Oracle                                                                                   | Gate               |
| --------------------- | ------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ------------------ |
| `CASE-PI-MODEL`       | `REQ-PI-001`        | Fake current Pi runtime returns success, provider error, and abort                         | Success text/usage maps; error and abort reject; signal reaches runtime                  | `GATE-CORRECTNESS` |
| `CASE-LIFECYCLE`      | `REQ-LIFECYCLE-001` | Construct extension, start once, shutdown twice                                            | No startup work at construction; cleanup runs safely                                     | `GATE-CORRECTNESS` |
| `CASE-TRUST`          | `REQ-TRUST-001`     | Resolve two cwd values under trusted/untrusted states                                      | Only trusted matching cwd contributes project manifests                                  | `GATE-SECURITY`    |
| `CASE-HOST-BOUNDARY`  | `INV-BOUNDARY-001`  | Search runtime sources and exercise construction                                           | Zero process exit/signal handlers and zero project manifest reads before trusted session | `GATE-SECURITY`    |
| `CASE-TYPES`          | `REQ-TYPES-001`     | Compile against installed Pi 0.81 declarations                                             | Zero registration double-casts or Pi signature errors                                    | `GATE-CORRECTNESS` |
| `CASE-CROSS-PLATFORM` | `REQ-CI-001`        | Run package selection/check scripts in PowerShell-compatible environment and lint workflow | Intended files execute; one budget source; workflow/docs checks pass                     | `GATE-COMPAT`      |
| `CASE-DEFERRED-TOOLS` | `REQ-LOAD-001`      | Register with `setActiveTools`, then activate a specialized tool                           | Common+loader initial set; activation is additive; all seven remain registered           | `GATE-CORRECTNESS` |
| `CASE-LEGACY-HOST`    | `COMPAT-TOOLS-001`  | Register without `setActiveTools`                                                          | Existing seven tools are registered and active; no loader dependency                     | `GATE-COMPAT`      |
| `CASE-CONTRACT-SIZE`  | `NFR-CONTRACT-001`  | Measure descriptions/schema characters for all-tools and dynamic initial sets              | Dynamic set is >=35% smaller and selection fixture failures remain zero                  | `GATE-QUALITY`     |

## Gates

### GATE-CORRECTNESS

- All applicable focused tests and typecheck pass.
- Missing, duplicate, or wrong-target registrations are zero.

### GATE-SECURITY

- Trust/cwd cases pass and structural host-boundary violations are zero.

### GATE-QUALITY

- `CASE-CONTRACT-SIZE` meets the frozen 35% reduction threshold.
- Existing deterministic selection fixture failures are zero.

### GATE-COMPAT

- Cross-platform scripts and legacy-host registration tests pass.
- Existing tool names, schemas, and non-live unit behavior have no unapproved drift.

## Negative controls

- Contract test: temporarily omit a required tool from the measured set; the gate must fail.
- Trust test: temporarily treat an untrusted project as trusted; the case must fail.
- Selection test: retain the existing negative fixtures and require wrong-tool suggestions to fail scoring.

## Observed treatment results

| Case | Result | Evidence |
| ---- | ------ | -------- |
| `CASE-PI-MODEL` | PASS | Pi 0.81 success/error/abort/usage tests plus real runtime initialization smoke |
| `CASE-LIFECYCLE` | PASS | Construction/start/double-shutdown lifecycle tests |
| `CASE-TRUST` | PASS | Untrusted, two-cwd, and cache-invalidation manifest tests |
| `CASE-HOST-BOUNDARY` | PASS | Structural test finds no process handlers or exits; project loads require explicit trust |
| `CASE-TYPES` | PASS | TypeScript compiles against Pi 0.81.1; native tool registration tests pass |
| `CASE-CROSS-PLATFORM` | PASS | PowerShell-compatible scripts, actionlint, docs contract, frozen Bun install, audit, and package dry-run pass |
| `CASE-DEFERRED-TOOLS` | PASS | Common+loader initial set and additive one-tool activation tests pass |
| `CASE-LEGACY-HOST` | PASS | Registrar without dynamic activation receives the existing seven tools |
| `CASE-CONTRACT-SIZE` | PASS | 1,489 to 724 tokens = 51.4% reduction; deterministic selection metrics remain 100% with zero critical confusions |

**Decision:** retain deferred loading. All frozen case thresholds pass; the separate pre-existing Windows full-suite limitations are recorded in `RESEARCH.md`.

## Artifact contract

Concise evidence in `RESEARCH.md` records the project versions, contract hash,
repository revision/dirty state, command, working directory, toolchain, bounded
result, and PASS/FAIL/INCONCLUSIVE decision. Raw transient output is not committed.

## Iteration procedure

1. Confirm the manifest task and authorization.
2. Run the cheapest focused baseline or inspect its current contract.
3. Implement one bounded task without changing frozen gates.
4. Run the named task check and record PASS, FAIL, or INCONCLUSIVE.
5. Advance task state in one checkpoint update.
6. Run phase gates only at phase completion and full gates only at project completion.

## Stop rules

Stop and request direction before changing the seven-tool public capability set,
scraping defaults, security model, compatibility promise, or frozen thresholds.
