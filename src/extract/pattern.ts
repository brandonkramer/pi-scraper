import type { ScrapeResult } from "../scrape/pipeline.js";
import { type ScrapePipelineDeps, scrapeUrl } from "../scrape/pipeline.js";
import {
	selectSymbolContent,
	type ExtractSchemaPreset,
	type SymbolIncludeFilter,
	type SymbolSelectionResult,
} from "./symbol-selection.js";
import type {
	CommonScrapeOptions,
	OutputFormat,
	StructuredError,
} from "../types.js";

const SOURCE_FORMATS = ["text", "markdown", "html"] as const;
const MAX_INSPECT_CHARS = 250_000;
const MAX_MARKERS = 50;
const MAX_REGEXES = 8;
const MAX_REGEX_LENGTH = 600;
const MAX_MATCHES = 100;
const MAX_EXCERPTS = 8;
const MAX_OCCURRENCES = 10;
const MAX_EXCERPT_CHARS = 8_000;
const VALID_REGEX_FLAGS = /^[dgimsuvy]*$/u;

export type PatternSourceFormat = (typeof SOURCE_FORMATS)[number];

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

export interface PatternInspectOptions
	extends Omit<CommonScrapeOptions, "include"> {
	url?: string;
	content?: string;
	sourceFormat?: PatternSourceFormat;
	length?: boolean;
	markers?: string[];
	contains?: string[];
	excerpts?: PatternExcerptRequest[];
	regexes?: PatternRegexRequest[];
	include?: SymbolIncludeFilter[];
	extractSchema?: ExtractSchemaPreset;
}

export interface PatternInspectResult {
	source: {
		url?: string;
		finalUrl?: string;
		source: "provided" | "scrape";
		sourceFormat: PatternSourceFormat;
		length: number;
		inspectedLength: number;
		truncated: boolean;
		mode?: string;
		status?: number;
		contentType?: string;
		cache?: ScrapeResult["cache"];
	};
	markers?: Array<{ marker: string; index: number; found: boolean }>;
	contains?: Array<{ needle: string; index: number; found: boolean }>;
	excerpts?: Array<{
		needle: string;
		index: number;
		occurrence: number;
		found: boolean;
		start?: number;
		end?: number;
		text?: string;
	}>;
	regexes?: Array<{
		name?: string;
		pattern: string;
		flags: string;
		matches: Array<{
			value: string;
			index: number;
			groups?: string[];
			namedGroups?: Record<string, string>;
			start?: number;
			end?: number;
			context?: string;
		}>;
		totalMatches: number;
		truncated: boolean;
	}>;
	selection?: SymbolSelectionResult;
}

export class PatternInspectError extends Error {
	readonly structured: StructuredError;

	constructor(message: string, code = "PATTERN_INPUT_INVALID", url?: string) {
		super(message);
		this.name = "PatternInspectError";
		this.structured = {
			code,
			phase: "pattern_extract",
			message,
			retryable: false,
			url,
		};
	}
}

export async function inspectPatterns(
	options: PatternInspectOptions,
	deps: ScrapePipelineDeps = {},
	signal?: AbortSignal,
): Promise<PatternInspectResult> {
	const prepared = await preparePatternSource(options, deps, signal);
	const inspected = prepared.content.slice(0, MAX_INSPECT_CHARS);
	return {
		source: {
			...prepared.source,
			length: prepared.content.length,
			inspectedLength: inspected.length,
			truncated: prepared.content.length > inspected.length,
		},
		markers: options.markers?.length
			? inspectMarkers(inspected, options.markers, options.url)
			: undefined,
		contains: options.contains?.length
			? inspectContains(inspected, options.contains, options.url)
			: undefined,
		excerpts: options.excerpts?.length
			? inspectExcerpts(inspected, options.excerpts, options.url)
			: undefined,
		regexes: options.regexes?.length
			? inspectRegexes(inspected, options.regexes, options.url)
			: undefined,
		selection: selectSymbolContent(inspected, {
			include: options.include,
			extractSchema: options.extractSchema,
			sourceFormat: prepared.source.sourceFormat,
		}),
	};
}

async function preparePatternSource(
	options: PatternInspectOptions,
	deps: ScrapePipelineDeps,
	signal?: AbortSignal,
): Promise<{
	content: string;
	source: Omit<
		PatternInspectResult["source"],
		"length" | "inspectedLength" | "truncated"
	>;
}> {
	const sourceFormat = options.sourceFormat ?? "text";
	if (!SOURCE_FORMATS.includes(sourceFormat)) {
		throw new PatternInspectError(
			`Unsupported sourceFormat: ${sourceFormat}`,
			"PATTERN_INPUT_INVALID",
			options.url,
		);
	}
	if (options.content !== undefined) {
		return {
			content: options.content,
			source: { url: options.url, source: "provided", sourceFormat },
		};
	}
	if (!options.url) {
		throw new PatternInspectError(
			"web_extract action=pattern requires url or content.",
			"MISSING_INPUT",
		);
	}
	const { content, include, extractSchema, ...scrapeOptions } = options;
	void content;
	void include;
	void extractSchema;
	const scrape = await scrapeUrl(
		options.url,
		{ ...scrapeOptions, format: sourceFormat as OutputFormat },
		deps,
		signal,
	);
	return {
		content: contentForFormat(scrape, sourceFormat),
		source: {
			url: options.url,
			finalUrl: scrape.finalUrl,
			source: "scrape",
			sourceFormat,
			mode: scrape.mode,
			status: scrape.status,
			contentType: scrape.contentType,
			cache: scrape.cache,
		},
	};
}

function contentForFormat(
	scrape: ScrapeResult,
	format: PatternSourceFormat,
): string {
	if (format === "html") return scrape.data.html ?? scrape.data.text ?? "";
	if (format === "markdown")
		return scrape.data.markdown ?? scrape.data.text ?? "";
	return scrape.data.text ?? scrape.data.markdown ?? scrape.data.html ?? "";
}

function inspectMarkers(content: string, markers: string[], url?: string) {
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

function inspectContains(content: string, needles: string[], url?: string) {
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

function inspectExcerpts(
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

function inspectRegexes(
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
	if (request.flags && !VALID_REGEX_FLAGS.test(request.flags))
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

function withGlobalFlag(flags: string): string {
	return Array.from(new Set(`${flags}g`.split(""))).join("");
}

function boundedInteger(value: number, min: number, max: number): number {
	if (!Number.isInteger(value) || value < min || value > max) {
		throw new PatternInspectError(
			`Expected integer between ${min} and ${max}.`,
			"PATTERN_LIMIT_EXCEEDED",
		);
	}
	return value;
}
