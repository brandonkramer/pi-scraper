/**
 * @fileoverview Regex inspection operation.
 */
import { MAX_REGEXES, MAX_REGEX_LENGTH, MAX_MATCHES } from "../limits.ts";
import { PatternInspectError } from "../errors.ts";
import { boundedInteger, withGlobalFlag } from "../bounds.ts";
import type { PatternRegexRequest } from "../types.ts";

export function inspectRegexes(
	content: string,
	requests: PatternRegexRequest[],
	url?: string,
) {
	if (requests.length > MAX_REGEXES)
		throw new PatternInspectError(
			`regexes is limited to ${MAX_REGEXES} entries.`,
			"PATTERN_LIMIT_EXCEEDED",
			url,
		);
	return requests.map((request) => inspectRegex(content, request, url));
}

function inspectRegex(
	content: string,
	request: PatternRegexRequest,
	url?: string,
) {
	if (!request.pattern || request.pattern.length > MAX_REGEX_LENGTH)
		throw new PatternInspectError(
			`regex pattern must be 1-${MAX_REGEX_LENGTH} characters.`,
			"PATTERN_INPUT_INVALID",
			url,
		);
	if (request.flags && !/^[dgimsuvy]*$/u.test(request.flags))
		throw new PatternInspectError(
			`Invalid regex flags: ${request.flags}`,
			"PATTERN_INPUT_INVALID",
			url,
		);
	const maxMatches = boundedInteger(request.maxMatches ?? 50, 1, MAX_MATCHES);
	const flags = withGlobalFlag(request.flags ?? "");
	let regex: RegExp;
	try {
		regex = new RegExp(request.pattern, flags);
	} catch (error) {
		throw new PatternInspectError(
			error instanceof Error ? error.message : "Invalid regex pattern.",
			"PATTERN_INPUT_INVALID",
			url,
		);
	}
	const matches = [];
	const seen = new Set<string>();
	let totalMatches = 0;
	let match: RegExpExecArray | null;
	while ((match = regex.exec(content)) && totalMatches <= maxMatches) {
		totalMatches += 1;
		const value = captureValue(match, request);
		if (!request.includeContains || value.includes(request.includeContains)) {
			if (!request.dedupe || !seen.has(value)) {
				seen.add(value);
				matches.push(formatMatch(content, match, value, request));
			}
		}
		if (match[0] === "") regex.lastIndex += 1;
	}
	if (request.sort) matches.sort((a, b) => a.value.localeCompare(b.value));
	return {
		name: request.name,
		pattern: request.pattern,
		flags,
		matches: matches.slice(0, maxMatches),
		totalMatches,
		truncated: totalMatches > maxMatches,
	};
}

function formatMatch(
	content: string,
	match: RegExpExecArray,
	value: string,
	request: PatternRegexRequest,
) {
	const start = match.index;
	const end = start + match[0].length;
	const contextBefore = boundedInteger(request.contextBefore ?? 0, 0, 250);
	const contextAfter = boundedInteger(request.contextAfter ?? 0, 0, 250);
	const context =
		contextBefore || contextAfter
			? content.slice(
					Math.max(0, start - contextBefore),
					Math.min(content.length, end + contextAfter),
				)
			: undefined;
	return {
		value,
		index: start,
		groups: match
			.slice(1)
			.filter((group): group is string => group !== undefined),
		namedGroups: match.groups,
		start,
		end,
		context,
	};
}

function captureValue(
	match: RegExpExecArray,
	request: PatternRegexRequest,
): string {
	if (request.captureGroup !== undefined)
		return match[request.captureGroup] ?? "";
	if (request.capture === "first") return match[1] ?? "";
	if (request.capture === "firstNonEmpty")
		return match.slice(1).find((item) => item) ?? match[0];
	return match[0];
}
