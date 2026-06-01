#!/usr/bin/env bash
set -euo pipefail

node <<'NODE'
const fs = require('fs');
const path = require('path');

const root = path.join(process.cwd(), 'src', 'tui');
const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__') walk(full);
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(full);
    }
  }
}
walk(root);
files.sort();

const metrics = {
  tui_loc: 0,
  tui_nonblank_loc: 0,
  renderer_loc: 0,
  shared_loc: 0,
  max_file_lines: 0,
  file_count: files.length,
};
const perFile = [];
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.length === 0 ? 0 : text.split(/\n/).length - (text.endsWith('\n') ? 1 : 0);
  const nonblank = text.split(/\n/).filter((line) => line.trim().length > 0).length;
  const rel = path.relative(process.cwd(), file);
  metrics.tui_loc += lines;
  metrics.tui_nonblank_loc += nonblank;
  if (rel.startsWith('src/tui/renderers/')) metrics.renderer_loc += lines;
  else metrics.shared_loc += lines;
  metrics.max_file_lines = Math.max(metrics.max_file_lines, lines);
  perFile.push(`${rel}:${lines}`);
}

for (const [name, value] of Object.entries(metrics)) console.log(`METRIC ${name}=${value}`);
console.log(`INFO per_file=${perFile.join(',')}`);
NODE
