# DOM adapter benchmarks

Benchmarks and parity checks for static DOM adapter behavior. These scripts compare the Cheerio fallback and the htmlparser2 default without changing production code.

| Script                 | Command                      | Output                                       |
| ---------------------- | ---------------------------- | -------------------------------------------- |
| `quality.mjs`          | `npm run compare:dom`        | `bench/results/dom-adapters/quality/`        |
| `timing.mjs`           | `npm run compare:dom:batch`  | `bench/results/dom-adapters/timing/`         |
| `memory.mjs`           | `npm run compare:dom:memory` | `bench/results/dom-adapters/memory/`         |
| `diff-stability.mjs`   | `npm run compare:dom:diff`   | `bench/results/dom-adapters/diff-stability/` |
| `prototype.mjs`        | `npm run spike:cheerio`      | `bench/results/dom-adapters/prototype/`      |
| `capture-fixtures.mjs` | `npm run capture:dom:real`   | `bench/fixtures/`                            |
