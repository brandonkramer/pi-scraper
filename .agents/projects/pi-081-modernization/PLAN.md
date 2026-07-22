# Pi 0.81 modernization — implementation design

> **Project state:** [`project.toml`](./project.toml)
> **Requirements:** [`SPEC.md`](./SPEC.md)
> **Atomic work:** [`TASKS.md`](./TASKS.md)
> **Measurement:** [`LOOP.md`](./LOOP.md)

## Build summary

Upgrade the lockstep Pi dependencies first and create one typed model execution
boundary. Then move resource ownership and project manifests onto session
context, remove type-erasing adapters, repair the verification surface, and
finally introduce deferred activation behind capability detection. Optimize
only after the repaired deterministic harness establishes a baseline.

## Architecture and ownership

| Surface            | Owner/path                                                       | Boundary                                                 |
| ------------------ | ---------------------------------------------------------------- | -------------------------------------------------------- |
| Model execution    | `src/model-adapter`, `src/tools/infra/model-adapter.ts`          | Current Pi runtime, explicit config, abort/error mapping |
| Session resources  | `src/index.ts`, `src/tools/infra/register.ts`, lifecycle helpers | Pi events own start and shutdown                         |
| Vertical manifests | `src/extract/vertical`                                           | Explicit cwd and trust key registry state                |
| Tool API           | `src/tools/infra/define.ts`, registration and health             | Native Pi types with no type-erasing registration cast   |
| Verification/docs  | `package.json`, CI, eval, README, skill docs                     | Cross-platform commands and one contract budget source   |
| Tool activation    | registration plus a lightweight loader                           | Register all; activate common set only when supported    |

## Requirement-to-phase map

| Phase | Requirements                                             | Exit condition                                            |
| ----- | -------------------------------------------------------- | --------------------------------------------------------- |
| MIG1  | `REQ-PI-001`                                             | `CASE-PI-MODEL` passes                                    |
| MIG2  | `REQ-LIFECYCLE-001`, `REQ-TRUST-001`, `INV-BOUNDARY-001` | `CASE-LIFECYCLE`, `CASE-TRUST`, `CASE-HOST-BOUNDARY` pass |
| MIG3  | `REQ-TYPES-001`                                          | `CASE-TYPES` passes                                       |
| MIG4  | `REQ-CI-001`                                             | `CASE-CROSS-PLATFORM` passes                              |
| MIG5  | `REQ-LOAD-001`, `NFR-CONTRACT-001`, `COMPAT-TOOLS-001`   | deferred, quality, and compatibility gates pass           |

## Dependency order

1. **MIG1 — Pi runtime.** Resolve 0.81.1 types and migrate model execution.
2. **MIG2 — Ownership boundaries.** Adopt lifecycle, trust, cwd, and cache scoping.
3. **MIG3 — Compile-time contracts.** Remove casts and align notices/signals.
4. **MIG4 — Verification.** Repair scripts, budget source, CI, and documentation.
5. **MIG5 — Optimization.** Add dynamic activation, compare against baseline, and retain fallback.

## Compatibility and migration

- Upgrade Pi coding-agent, TUI, and AI requirements in lockstep.
- Preserve external model-adapter events as the first explicit override.
- Preserve all-tool activation when `setActiveTools` is unavailable.
- Preserve the seven existing public tool names; the loader is additive only on capable hosts.

## Verification strategy

Run focused tests after each slice, then typecheck, lint/format checks, selection
tests, and the full unit suite. Do not run development servers, builds, or live
network/browser smoke tests. Deferred activation is accepted only if both the
contract-size threshold and existing fixture accuracy pass.

## Intentional implementation freedom

- The adapter may use `ModelRuntime` or lower-level current Pi model facilities,
  whichever is smallest after inspecting the installed declarations.
- The lightweight discovery path may be a dedicated tool or an existing command
  only if a model can reliably activate every specialized tool.
