/**
 * @fileoverview Marker inspection operation.
 */
import { MAX_MARKERS } from "../limits.ts";
import { PatternInspectError } from "../errors.ts";

export function inspectMarkers(
	content: string,
	markers: string[],
	url?: string,
) {
	if (markers.length > MAX_MARKERS)
		throw new PatternInspectError(
			`markers is limited to ${MAX_MARKERS} entries.`,
			"PATTERN_LIMIT_EXCEEDED",
			url,
		);
	return markers.map((marker) => {
		const index = content.indexOf(marker);
		return { marker, index, found: index >= 0 };
	});
}
