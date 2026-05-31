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
node --input-type=module -e "
import { webTools } from './src/tools/infra/register.ts';

function approxTokens(s) { return Math.ceil(s.length / 4); }

let total = 0;
const counts = {};

for (const tool of webTools) {
  const contract = JSON.stringify({
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: tool.parameters,
  });
  const tokens = approxTokens(contract.length);
  const key = tool.name.replace('web_', '');
  counts[key] = tokens;
  total += tokens;
}

console.log('METRIC total_tokens=' + total);
for (const [k, v] of Object.entries(counts)) {
  console.log('METRIC ' + k + '_tokens=' + v);
}

// Also output per-tool param counts for diagnostics
for (const tool of webTools) {
  const props = tool.parameters.properties || {};
  const withDesc = Object.values(props).filter(p => p.description).length;
  const key = tool.name.replace('web_', '');
  console.log('DIAG ' + key + '=' + Object.keys(props).length + 'params,' + withDesc + 'desc');
}
" 2>&1
