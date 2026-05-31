#!/bin/bash
set -euo pipefail

# Fast structural workload: count non-test src/tui TypeScript LOC and related shape metrics.
mapfile -t files < <(find src/tui -type f -name '*.ts' ! -path '*/__tests__/*' | sort)
if ((${#files[@]} == 0)); then
  echo "no src/tui TypeScript files found" >&2
  exit 1
fi

count_lines() {
  if (($# == 0)); then
    echo 0
    return
  fi
  wc -l "$@" | awk 'END { print $1 }'
}

tui_loc=$(count_lines "${files[@]}")
file_count=${#files[@]}
max_file_loc=$(wc -l "${files[@]}" | awk '$2 != "total" && $1 > max { max = $1 } END { print max + 0 }')
mapfile -t renderer_files < <(printf '%s\n' "${files[@]}" | grep '^src/tui/renderers/' || true)
mapfile -t helper_files < <(printf '%s\n' "${files[@]}" | grep -v '^src/tui/renderers/' || true)
renderer_loc=$(count_lines "${renderer_files[@]}")
helper_loc=$(count_lines "${helper_files[@]}")

printf 'METRIC tui_loc=%s\n' "$tui_loc"
printf 'METRIC max_file_loc=%s\n' "$max_file_loc"
printf 'METRIC file_count=%s\n' "$file_count"
printf 'METRIC renderer_loc=%s\n' "$renderer_loc"
printf 'METRIC helper_loc=%s\n' "$helper_loc"
