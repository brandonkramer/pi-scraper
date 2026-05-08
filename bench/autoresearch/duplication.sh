#!/usr/bin/env bash
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

PYTHON_BIN=${PYTHON_BIN:-}
if [[ -z "$PYTHON_BIN" && -f graphify-out/.graphify_python ]]; then
	PYTHON_BIN=$(cat graphify-out/.graphify_python)
fi
if [[ -z "$PYTHON_BIN" ]]; then
	PYTHON_BIN=python3
fi

"$PYTHON_BIN" - <<'PY'
import itertools
import json
import re
from collections import defaultdict
from pathlib import Path

from graphify.extract import collect_files, extract

ROOT = Path.cwd()
SOURCE_ROOTS = [Path("src")]
INTENTIONAL_DUP_FILES = {
    frozenset({"src/storage/results.ts", "src/storage/migrate-from-files.ts"}),
}
IGNORED_DUP_LABELS = {".constructor()"}

files = []
for root in SOURCE_ROOTS:
    files.extend(collect_files(root))

result = extract(files, cache_root=ROOT)
nodes = result.get("nodes", [])
edges = result.get("edges", [])
by_id = {node.get("id"): node for node in nodes}


def canon_source(value: str | None) -> str:
    if not value:
        return ""
    path = Path(value)
    if path.is_absolute():
        try:
            return path.relative_to(ROOT).as_posix()
        except ValueError:
            return path.as_posix()
    raw = path.as_posix()
    if raw.startswith("src/"):
        return raw
    if (ROOT / raw).exists():
        return raw
    src_candidate = ROOT / "src" / raw
    if src_candidate.exists():
        return f"src/{raw}"
    return raw


def is_source_node(node: dict) -> bool:
    source = canon_source(node.get("source_file"))
    return source.startswith("src/") and "/__tests__/" not in source


def is_function_node(node: dict) -> bool:
    label = str(node.get("label", ""))
    return is_source_node(node) and bool(
        label.endswith("()") or re.match(r"^\.?[A-Za-z_$][\w$]*\(\)$", label)
    )


def intentional_pair(a: str, b: str) -> bool:
    pair = frozenset({a, b})
    return pair in INTENTIONAL_DUP_FILES

function_nodes = [node for node in nodes if is_function_node(node)]
by_label = defaultdict(list)
for node in function_nodes:
    by_label[node.get("label", "")].append(node)

duplicate_groups = []
duplicate_nodes = 0
for label, group in by_label.items():
    if label in IGNORED_DUP_LABELS:
        continue
    files_for_group = {canon_source(node.get("source_file")) for node in group}
    if len(files_for_group) <= 1:
        continue
    if len(files_for_group) == 2 and intentional_pair(*tuple(files_for_group)):
        continue
    duplicate_groups.append((label, group, files_for_group))
    duplicate_nodes += len(group)

calls_by_source = defaultdict(set)
for edge in edges:
    if edge.get("relation") == "calls":
        calls_by_source[edge.get("source")].add(edge.get("target"))

call_items = []
for node_id, targets in calls_by_source.items():
    node = by_id.get(node_id)
    if not node or not is_function_node(node) or len(targets) < 3:
        continue
    call_items.append((node_id, targets))

high_overlap_pairs = []
medium_overlap_pairs = []
exact_workflow_groups = defaultdict(list)
for node_id, targets in call_items:
    labels = tuple(sorted(by_id.get(target, {}).get("label", target) for target in targets))
    if len(labels) >= 3:
        exact_workflow_groups[labels].append(node_id)

exact_workflow_count = 0
for labels, ids in list(exact_workflow_groups.items()):
    files_for_group = {canon_source(by_id[item].get("source_file")) for item in ids}
    if len(files_for_group) > 1:
        exact_workflow_count += 1

for (left_id, left_targets), (right_id, right_targets) in itertools.combinations(call_items, 2):
    left = by_id[left_id]
    right = by_id[right_id]
    left_file = canon_source(left.get("source_file"))
    right_file = canon_source(right.get("source_file"))
    if left_file == right_file or intentional_pair(left_file, right_file):
        continue
    shared = left_targets & right_targets
    if len(shared) < 3:
        continue
    score = len(shared) / len(left_targets | right_targets)
    record = (score, len(shared), left, right)
    if score >= 0.5:
        high_overlap_pairs.append(record)
    elif score >= 0.35:
        medium_overlap_pairs.append(record)

# Deliberately simple and integer-valued. Exact duplicate names are noisy but
# useful; call-overlap carries more weight because it catches repeated workflows.
duplication_score = (
    10 * len(duplicate_groups)
    + 2 * duplicate_nodes
    + 12 * len(high_overlap_pairs)
    + 5 * len(medium_overlap_pairs)
    + 15 * exact_workflow_count
)

print(f"METRIC duplication_score={duplication_score}")
print(f"METRIC duplicate_function_groups={len(duplicate_groups)}")
print(f"METRIC duplicate_function_nodes={duplicate_nodes}")
print(f"METRIC high_call_overlap_pairs={len(high_overlap_pairs)}")
print(f"METRIC medium_call_overlap_pairs={len(medium_overlap_pairs)}")
print(f"METRIC exact_workflow_groups={exact_workflow_count}")
print(f"METRIC graph_nodes={len(nodes)}")
print(f"METRIC graph_edges={len(edges)}")

for label, group, files_for_group in sorted(
    duplicate_groups, key=lambda item: (-len(item[2]), str(item[0]))
)[:8]:
    locations = ", ".join(
        f"{canon_source(node.get('source_file'))}:{node.get('source_location')}"
        for node in sorted(group, key=lambda n: (canon_source(n.get("source_file")), str(n.get("source_location"))))
    )
    print(f"DUPLICATE {label}: {locations}")

for score, shared_count, left, right in sorted(
    high_overlap_pairs + medium_overlap_pairs,
    key=lambda item: (-item[0], -item[1]),
)[:8]:
    print(
        "OVERLAP "
        f"{score:.2f} shared={shared_count}: "
        f"{left.get('label')} {canon_source(left.get('source_file'))}:{left.get('source_location')} <-> "
        f"{right.get('label')} {canon_source(right.get('source_file'))}:{right.get('source_location')}"
    )
PY

TYPECHECK_LOG=$(mktemp)
TEST_LOG=$(mktemp)
trap 'rm -f "$TYPECHECK_LOG" "$TEST_LOG"' EXIT

if ! npm run typecheck >"$TYPECHECK_LOG" 2>&1; then
	echo "typecheck failed" >&2
	tail -80 "$TYPECHECK_LOG" >&2
	exit 1
fi

if ! npm test >"$TEST_LOG" 2>&1; then
	echo "tests failed" >&2
	tail -80 "$TEST_LOG" >&2
	exit 1
fi
