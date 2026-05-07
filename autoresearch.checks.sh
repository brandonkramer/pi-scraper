#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

# Typecheck
npm run typecheck 2>&1 | tail -20

# Run tests (suppress verbose success output)
npm test 2>&1 | tail -30

# Run eval to ensure quality signals still pass
node bench/bin/bench.mjs eval/corpus.json --warmup=1 --repeats=1 >/dev/null 2>&1
