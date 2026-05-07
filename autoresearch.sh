#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

# Run eval benchmark with stable repetition counts
node bench/bin/bench.mjs eval/corpus.json --warmup=5 --repeats=30 >/dev/null 2>&1

# Find the latest result JSON
latest_json=$(ls -t bench/results/eval-corpus/history/*.json | head -n1)

# Extract metrics with Node
node --input-type=module -e "
import { readFileSync } from 'fs';
const data = JSON.parse(readFileSync('$latest_json', 'utf8'));
let total = 0;
let meanSum = 0;
let largeDocs = 0;
let staticArticle = 0;
for (const r of data.results) {
  const m = r.perf?.median_ms ?? 0;
  total += m;
  meanSum += m;
  if (r.id === 'large-docs-page') largeDocs = m;
  if (r.id === 'static-article') staticArticle = m;
}
const meanMedian = meanSum / data.results.length;
console.log('METRIC total_median_ms=' + total.toFixed(2));
console.log('METRIC large_docs_ms=' + largeDocs.toFixed(2));
console.log('METRIC static_article_ms=' + staticArticle.toFixed(2));
console.log('METRIC mean_median_ms=' + meanMedian.toFixed(2));

// Per-case breakdown for diagnostics
for (const r of data.results) {
  const id = r.id;
  const m = r.perf?.median_ms ?? 0;
  console.log('CASE ' + id + '=' + m.toFixed(2));
}
"
