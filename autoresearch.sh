#!/bin/bash
set -euo pipefail

# Fast structural workload: count non-test src/tui TypeScript LOC and related shape metrics.
files=()
while IFS= read -r file; do
  files+=("$file")
done < <(find src/tui -type f -name '*.ts' ! -path '*/__tests__/*' | sort)
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
renderer_files=()
helper_files=()
while IFS= read -r file; do
  case "$file" in
    src/tui/renderers/*) renderer_files+=("$file") ;;
    *) helper_files+=("$file") ;;
  esac
done < <(printf '%s\n' "${files[@]}")
renderer_loc=$(count_lines "${renderer_files[@]}")
helper_loc=$(count_lines "${helper_files[@]}")

printf 'METRIC tui_loc=%s\n' "$tui_loc"
printf 'METRIC max_file_loc=%s\n' "$max_file_loc"
printf 'METRIC file_count=%s\n' "$file_count"
printf 'METRIC renderer_loc=%s\n' "$renderer_loc"
printf 'METRIC helper_loc=%s\n' "$helper_loc"
