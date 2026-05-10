/**
 * @fileoverview extract pattern module.
 */
import type { ScrapeResult } from "../scrape/pipeline.ts";
import { type ScrapePipelineDeps, scrapeUrl } from "../scrape/pipeline.ts";
import {
	selectSymbolContent,
	type ExtractSchemaPreset,
	type SymbolIncludeFilter,
	type SymbolSelectionResult,
} from "./symbol-selection.ts";
import {
	evaluateJsonPaths,
	flattenJsonValues,
	isSupportedJsonPath,
	parseJsonSafe,
} from "./json-path.ts";
import {
	inspectContains,
	inspectExcerpts,
	inspectMarkers,
	inspectRegexes,
	inspectSections,
	MAX_INSPECT_CHARS,
	PatternInspectError,
	type PatternExcerptRequest,
	type PatternRegexRequest,
} from "./pattern-inspect-ops.ts";
import type { CommonScrapeOptions, OutputFormat } from "../types.ts";

const SOURCE_FORMATS = ["text", "markdown", "html", "json"] as const;

export type PatternSourceFormat = (typeof SOURCE_FORMATS)[number];

export type PatternSectionRequest =
	import("./section-ranges.ts").SectionRangeRequest;

export interface PatternInspectOptions
	extends Omit<CommonScrapeOptions, "include"> {
	url?: string;
	content?: string;
	sourceFormat?: PatternSourceFormat;
	jsonPaths?: string[];
	length?: boolean;
	markers?: string[];
	contains?: string[];
	excerpts?: PatternExcerptRequest[];
	regexes?: PatternRegexRequest[];
	sections?: PatternSectionRequest[];
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
		json?: {
			paths: Array<{ path: string; matched: number; missing: boolean }>;
			selectedLength: number;
		};
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
	sections?: import("./section-ranges.ts").SectionRangeResult[];
	selection?: SymbolSelectionResult;
}

export { PatternInspectError };

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
		sections: options.sections?.length
			? inspectSections(inspected, options.sections, options.url)
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
	if (sourceFormat === "json" && options.jsonPaths?.length) {
		const invalidPath = options.jsonPaths.find((p) => !isSupportedJsonPath(p));
		if (invalidPath) {
			throw new PatternInspectError(
				`Unsupported JSONPath syntax: ${invalidPath}`,
				"JSON_PATH_UNSUPPORTED",
				options.url,
			);
		}
	}
	if (options.content !== undefined) {
		if (sourceFormat === "json") {
			return prepareJsonSource(options.content, {
				url: options.url,
				jsonPaths: options.jsonPaths,
				source: "provided",
			});
		}
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
	const { content, include, extractSchema, jsonPaths, ...scrapeOptions } =
		options;
	void content;
	void include;
	void extractSchema;
	void jsonPaths;
	const scrape = await scrapeUrl(
		options.url,
		{ ...scrapeOptions, format: sourceFormat as OutputFormat },
		deps,
		signal,
	);
	if (sourceFormat === "json") {
		const jsonText =
			scrape.data.json !== undefined
				? JSON.stringify(scrape.data.json)
				: (scrape.data.text ?? "");
		return prepareJsonSource(jsonText, {
			url: options.url,
			finalUrl: scrape.finalUrl,
			jsonPaths: options.jsonPaths,
			source: "scrape",
			mode: scrape.mode,
			status: scrape.status,
			contentType: scrape.contentType,
			cache: scrape.cache,
		});
	}
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

function prepareJsonSource(
	content: string,
	meta: {
		url?: string;
		finalUrl?: string;
		jsonPaths?: string[];
		source: "provided" | "scrape";
		mode?: string;
		status?: number;
		contentType?: string;
		cache?: ScrapeResult["cache"];
	},
): {
	content: string;
	source: Omit<
		PatternInspectResult["source"],
		"length" | "inspectedLength" | "truncated"
	>;
} {
	const parsed = parseJsonSafe(content);
	if (parsed.error) {
		throw new PatternInspectError(
			parsed.error.message,
			parsed.error.code,
			meta.url,
		);
	}
	const paths = meta.jsonPaths?.length ? meta.jsonPaths : ["$"];
	const { values, infos, errors } = evaluateJsonPaths(parsed.data, paths);
	if (errors.length) {
		throw new PatternInspectError(
			errors.map((e) => `${e.path}: ${e.message}`).join("; "),
			errors[0]!.code,
			meta.url,
		);
	}
	const allMissing = infos.every((info) => info.missing);
	if (allMissing && infos.length > 0) {
		throw new PatternInspectError(
			`No values matched JSONPath expressions.`,
			"JSON_PATH_NO_MATCH",
			meta.url,
		);
	}
	const selectedText = flattenJsonValues(values);
	return {
		content: selectedText,
		source: {
			url: meta.url,
			finalUrl: meta.finalUrl,
			source: meta.source,
			sourceFormat: "json",
			mode: meta.mode,
			status: meta.status,
			contentType: meta.contentType,
			cache: meta.cache,
			json: {
				paths: infos,
				selectedLength: selectedText.length,
			},
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
	if (format === "json") {
		if (scrape.data.json !== undefined) {
			try {
				return JSON.stringify(scrape.data.json);
			} catch {
				return String(scrape.data.json);
			}
		}
		return scrape.data.text ?? "";
	}
	return scrape.data.text ?? scrape.data.markdown ?? scrape.data.html ?? "";
}

export {
	PatternExcerptRequest,
	PatternRegexRequest,
} from "./pattern-inspect-ops.ts";
