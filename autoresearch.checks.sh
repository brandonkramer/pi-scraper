#!/bin/bash
set -euo pipefail
# TypeScript compilation — will fail on type errors
npx tsc --noEmit 2>&1 | tail -10
# Tool contract tests — schema tests, discriminator tests, field membership tests
npx vitest run --reporter=dot src/tools/__tests__/tool-contract.test.ts 2>&1 | tail -10
# Register tests — tools register correctly
npx vitest run --reporter=dot src/tools/__tests__/register.test.ts 2>&1 | tail -10
