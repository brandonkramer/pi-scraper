/** @file Pattern extraction public entrypoint. */
import type { ScrapePipelineDeps, ScrapeResult } from "../../scrape/pipeline.ts";
import type { CommonScrapeOptions } from "../../types.ts";
import { selectSymbolContent } from "../api-surface/selection.ts";
import type {
	ExtractSchemaPreset,
	SymbolIncludeFilter,
	SymbolSelectionResult,
} from "../api-surface/types.ts";
import { PatternInspectError } from "./errors.ts";
import { MAX_INSPECT_CHARS } from "./limits.ts";
import {
	inspectContains,
	inspectExcerpts,
	inspectMarkers,
	inspectRegexes,
	inspectSections,
} from "./ops/index.ts";
import { preparePatternSource } from "./runner.ts";
import type { SectionRangeRequest, SectionRangeResult } from "./section-ranges.ts";
import type { PatternExcerptRequest, PatternRegexRequest } from "./types.ts";

const SOURCE_FORMATS = ["text", "markdown", "html", "json"] as const;

export type PatternSourceFormat = (typeof SOURCE_FORMATS)[number];

export type PatternSectionRequest = SectionRangeRequest;

export interface PatternInspectOptions extends Omit<CommonScrapeOptions, "include"> {
	url?: string;
	content?: string;
	responseId?: string;
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
		source: "provided" | "scrape" | "stored";
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
	sections?: SectionRangeResult[];
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

export type { PatternExcerptRequest, PatternRegexRequest } from "./types.ts";
