#!/bin/bash
set -euo pipefail

# Preflight: typecheck first — if it errors, report as failure fast
if ! npx tsc --noEmit 2>&1 | head -20; then
  echo "PRECHECK_FAILED: TypeScript compilation error"
  exit 1
fi

# Run the three test files that validate tool contracts + non-tool tests
# Use --run mode (no watch), reporter=dot for minimal noise
npx vitest run --reporter=dot \
  src/tools/__tests__/tool-contract.test.ts \
  src/tools/__tests__/tool-selection-fixtures.test.ts \
  src/tools/__tests__/register.test.ts \
  2>&1 | tail -20

# Extract per-tool token counts by running a dedicated extraction script
# We inline it here to keep everything in one file
npx tsx src/tools/__tests__/tool-contract-stats.ts 2>&1
