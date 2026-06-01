#!/usr/bin/env bash
set -euo pipefail

run_quiet() {
  local label="$1"
  shift
  local log
  log="$(mktemp)"
  if ! "$@" >"$log" 2>&1; then
    echo "${label} failed" >&2
    tail -80 "$log" >&2
    rm -f "$log"
    return 1
  fi
  rm -f "$log"
}

run_quiet typecheck npm run typecheck -- --pretty false
run_quiet renderer-tests npx vitest run src/tui/__tests__/components.test.ts src/tools/__tests__/renderers.test.ts --reporter=dot
