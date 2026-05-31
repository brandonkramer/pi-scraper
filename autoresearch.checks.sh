#!/bin/bash
set -euo pipefail

npm run typecheck -- --pretty false >/tmp/pi-scraper-tui-typecheck.log 2>&1 || {
  tail -80 /tmp/pi-scraper-tui-typecheck.log
  exit 1
}

npx vitest run \
  src/tui/__tests__/components.test.ts \
  src/tools/__tests__/renderers.test.ts \
  src/tools/__tests__/tui-boundary.test.ts \
  --reporter=dot >/tmp/pi-scraper-tui-vitest.log 2>&1 || {
  tail -80 /tmp/pi-scraper-tui-vitest.log
  exit 1
}
