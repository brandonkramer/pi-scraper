/**
 * @fileoverview Contains inspection operation.
 */
import { MAX_MARKERS } from "../limits.ts";
import { PatternInspectError } from "../errors.ts";

export function inspectContains(
	content: string,
	needles: string[],
	url?: string,
) {
	if (needles.length > MAX_MARKERS)
		throw new PatternInspectError(
			`contains is limited to ${MAX_MARKERS} entries.`,
			"PATTERN_LIMIT_EXCEEDED",
			url,
		);
	return needles.map((needle) => {
		const index = content.indexOf(needle);
		return { needle, index, found: index >= 0 };
	});
}
