/**
 * @fileoverview Deterministic text section extraction for pattern inspection.
 */

const MAX_SECTIONS = 12;
const MAX_SECTION_CHARS = 40_000;

export interface SectionRangeRequest {
	name?: string;
	start: string;
	end?: string;
	includeStart?: boolean;
	includeEnd?: boolean;
	caseSensitive?: boolean;
	maxChars?: number;
}

export interface SectionRangeResult {
	name?: string;
	start: string;
	end?: string;
	startIndex: number;
	endIndex?: number;
	found: boolean;
	endFound?: boolean;
	truncated?: boolean;
	text?: string;
}

export class SectionRangeError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SectionRangeError";
	}
}

export function extractSectionRanges(
	content: string,
	sections: SectionRangeRequest[],
): SectionRangeResult[] {
	if (sections.length > MAX_SECTIONS) {
		throw new SectionRangeError(
			`sections is limited to ${MAX_SECTIONS} entries.`,
		);
	}
	return sections.map((section) => extractSectionRange(content, section));
}

function extractSectionRange(
	content: string,
	section: SectionRangeRequest,
): SectionRangeResult {
	if (!section.start) {
		throw new SectionRangeError("section start must be non-empty.");
	}
	const haystack =
		section.caseSensitive === false ? content.toLowerCase() : content;
	const startNeedle = normalizeNeedle(section.start, section.caseSensitive);
	const endNeedle = section.end
		? normalizeNeedle(section.end, section.caseSensitive)
		: undefined;
	const startIndex = haystack.indexOf(startNeedle);
	if (startIndex < 0) return missingSection(section);
	const contentStart =
		section.includeStart === false
			? startIndex + section.start.length
			: startIndex;
	const searchFrom = startIndex + Math.max(1, section.start.length);
	const rawEndIndex = endNeedle ? haystack.indexOf(endNeedle, searchFrom) : -1;
	const endFound = endNeedle ? rawEndIndex >= 0 : undefined;
	const sectionEnd = rawEndIndex >= 0 ? rawEndIndex : content.length;
	const contentEnd =
		section.includeEnd && rawEndIndex >= 0 && section.end
			? rawEndIndex + section.end.length
			: sectionEnd;
	const maxChars = clampSectionMaxChars(section.maxChars ?? MAX_SECTION_CHARS);
	const boundedEnd = Math.min(contentEnd, contentStart + maxChars);
	return {
		name: section.name,
		start: section.start,
		end: section.end,
		startIndex,
		endIndex: rawEndIndex >= 0 ? rawEndIndex : undefined,
		found: true,
		endFound,
		truncated: boundedEnd < contentEnd,
		text: content.slice(contentStart, boundedEnd),
	};
}

function normalizeNeedle(
	needle: string,
	caseSensitive: boolean | undefined,
): string {
	return caseSensitive === false ? needle.toLowerCase() : needle;
}

function missingSection(section: SectionRangeRequest): SectionRangeResult {
	return {
		name: section.name,
		start: section.start,
		end: section.end,
		startIndex: -1,
		found: false,
		endFound: section.end ? false : undefined,
	};
}

function clampSectionMaxChars(value: number): number {
	if (!Number.isInteger(value) || value < 1 || value > MAX_SECTION_CHARS) {
		throw new SectionRangeError(
			`section maxChars must be an integer between 1 and ${MAX_SECTION_CHARS}.`,
		);
	}
	return value;
}
