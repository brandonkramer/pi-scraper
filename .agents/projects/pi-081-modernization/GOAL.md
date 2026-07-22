# Goal: Pi 0.81 modernization

> **Project:** `pi-081-modernization`
> **Manifest:** [`project.toml`](./project.toml)
> **Requirements:** [`SPEC.md`](./SPEC.md)
> **Evidence:** [`RESEARCH.md`](./RESEARCH.md)
> **Build design:** [`PLAN.md`](./PLAN.md)
> **Work queue:** [`TASKS.md`](./TASKS.md)
> **Measurement:** [`LOOP.md`](./LOOP.md)

## Persistent objective

Modernize pi-scraper for the current Pi 0.81 release line while preserving its
existing scraping behavior, strengthening lifecycle and trust boundaries, and
measuring whether deferred tool loading improves the tool contract.

## User-visible outcome

1. Model-backed extraction uses supported Pi APIs and abort/error semantics.
2. Extension resources follow Pi session lifecycle and project trust.
3. Tools remain discoverable while common turns carry a smaller active contract.
4. Cross-platform checks, docs, and declared budgets agree with the implementation.

## Completion boundary

- All seven requirements in `SPEC.md` map to implemented tasks and passing gates.
- Pi packages resolve on the 0.81 release line and TypeScript exposes their real APIs.
- Focused tests, typecheck, lint/format, selection, audit, workflow, and package gates pass; the local full-suite result and platform-specific exceptions are recorded explicitly.
- The deferred-loading comparison records before/after contract size and fixture results.

## Constraints

- Do not run a development server or production build.
- Use Bun for package and script execution in this workspace.
- Keep the public seven-tool capability set and existing scraping defaults.
- Do not introduce `any` to bypass Pi type changes.

## Non-goals

- Redesigning scraping, browser automation, extraction algorithms, or storage.
- Publishing a release, pushing a branch, or changing production configuration.

## Authority

The user's 2026-07-21 request authorizes implementation of all six reviewed
improvements. Persistent goal activation and external publication remain disabled.
