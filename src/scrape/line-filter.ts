/** @file Deterministic line filtering for raw/code inspection. */

export interface LineMatchContext {
	line: number;
	text: string;
}

export interface LineMatch {
	needle: string;
	line: number;
	text: string;
	contextBefore: LineMatchContext[];
	contextAfter: LineMatchContext[];
}

/**
 * Filter decoded text content by line against one or more needles.
 *
 * @remarks
 *   Non-LLM, deterministic; dedupes by (needle, line). Context windows may overlap across different
 *   needles; callers merge for display if needed.
 */
export function filterLines(
	text: string,
	needles: readonly string[],
	contextLines = 0,
	caseSensitive = false,
): LineMatch[] {
	const lines = text.split(/\r?\n/u);
	const seen = new Set<string>();
	const matches: LineMatch[] = [];

	for (const needle of needles) {
		if (!needle) continue;
		const search = caseSensitive ? needle : needle.toLowerCase();
		for (let i = 0; i < lines.length; i++) {
			const lineText = lines[i] ?? "";
			const compare = caseSensitive ? lineText : lineText.toLowerCase();
			if (!compare.includes(search)) continue;
			const key = `${needle}:${i + 1}`;
			if (seen.has(key)) continue;
			seen.add(key);
			matches.push({
				needle,
				line: i + 1,
				text: lineText,
				contextBefore:
					contextLines > 0
						? lines.slice(Math.max(0, i - contextLines), i).map((t, idx) => ({
								line: Math.max(0, i - contextLines) + idx + 1,
								text: t,
							}))
						: [],
				contextAfter:
					contextLines > 0
						? lines.slice(i + 1, Math.min(lines.length, i + 1 + contextLines)).map((t, idx) => ({
								line: i + 1 + idx + 1,
								text: t,
							}))
						: [],
			});
		}
	}
	return matches;
}
