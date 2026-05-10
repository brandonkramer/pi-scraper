/**
 * @fileoverview Pattern inspection request types.
 */
export interface PatternExcerptRequest {
	needle: string;
	before?: number;
	after?: number;
	caseSensitive?: boolean;
	maxOccurrences?: number;
}

export interface PatternRegexRequest {
	name?: string;
	pattern: string;
	flags?: string;
	capture?: "full" | "first" | "firstNonEmpty";
	captureGroup?: number;
	includeContains?: string;
	maxMatches?: number;
	dedupe?: boolean;
	sort?: boolean;
	contextBefore?: number;
	contextAfter?: number;
}
