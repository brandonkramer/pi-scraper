/**
 * @fileoverview Excerpt inspection operation.
 */
import { MAX_EXCERPTS, MAX_EXCERPT_CHARS, MAX_OCCURRENCES } from "../limits.ts";
import { PatternInspectError } from "../errors.ts";
import { boundedInteger } from "../shared.ts";
import type { PatternExcerptRequest } from "../types.ts";

export function inspectExcerpts(
	content: string,
	requests: PatternExcerptRequest[],
	url?: string,
) {
	if (requests.length > MAX_EXCERPTS)
		throw new PatternInspectError(
			`excerpts is limited to ${MAX_EXCERPTS} entries.`,
			"PATTERN_LIMIT_EXCEEDED",
			url,
		);
	return requests.flatMap((request) =>
		excerptsForNeedle(content, request, url),
	);
}

function excerptsForNeedle(
	content: string,
	request: PatternExcerptRequest,
	url?: string,
) {
	if (!request.needle)
		throw new PatternInspectError(
			"excerpt needle must be non-empty.",
			undefined,
			url,
		);
	const before = boundedInteger(request.before ?? 200, 0, MAX_EXCERPT_CHARS);
	const after = boundedInteger(request.after ?? 200, 0, MAX_EXCERPT_CHARS);
	if (before + after > MAX_EXCERPT_CHARS)
		throw new PatternInspectError(
			`excerpt before+after is limited to ${MAX_EXCERPT_CHARS} characters.`,
			"PATTERN_LIMIT_EXCEEDED",
			url,
		);
	const maxOccurrences = boundedInteger(
		request.maxOccurrences ?? 1,
		1,
		MAX_OCCURRENCES,
	);
	const haystack = request.caseSensitive ? content : content.toLowerCase();
	const needle = request.caseSensitive
		? request.needle
		: request.needle.toLowerCase();
	const output = [];
	let fromIndex = 0;
	for (let occurrence = 1; occurrence <= maxOccurrences; occurrence++) {
		const index = haystack.indexOf(needle, fromIndex);
		if (index < 0) {
			if (occurrence === 1)
				output.push({
					needle: request.needle,
					index: -1,
					occurrence,
					found: false,
				});
			break;
		}
		const start = Math.max(0, index - before);
		const end = Math.min(content.length, index + request.needle.length + after);
		output.push({
			needle: request.needle,
			index,
			occurrence,
			found: true,
			start,
			end,
			text: content.slice(start, end),
		});
		fromIndex = index + Math.max(1, needle.length);
	}
	return output;
}
