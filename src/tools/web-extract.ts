/**
 * @fileoverview Pi tool adapter for vertical, pattern, ad hoc, and surface extraction.
 */
import { type Static, Type } from "@earendil-works/pi-ai";
import { loadEffectiveConfig } from "../config/settings.js";
import { extractAdHoc, MissingExtractInputError } from "../extract/ad-hoc.js";
import type { ModelAdapter } from "../extract/model.js";
import {
	inspectPatterns,
	PatternInspectError,
	type PatternInspectOptions,
} from "../extract/pattern.js";
import type { VerticalExtractionResult } from "../extract/capabilities.js";
import type { ScrapePipelineDeps } from "../scrape/pipeline.js";
import { qualityFromCache, storedResultGuidance } from "./agentic-context.js";
import { defineWebTool, type WebTool } from "./define.js";
import { emitProgress } from "./progress.js";
import { renderEnvelopeResult, renderSimpleCall } from "./render.js";
import {
	errorResult,
	missingModelError,
	structuredToolError,
	toolResult,
} from "./result.js";
import { urlProperty } from "./schemas.js";
import { runApiSurfaceExtraction } from "./web-extract-surface.js";

const extractActions = [
	"list",
	"vertical",
	"adhoc",
	"pattern",
	"surface",
] as const;
export const webExtractSchema = Type.Object({
	action: Type.Optional(Type.Any()),
	extractor: Type.Optional(Type.Any()),
	url: Type.Optional(urlProperty()),
	content: Type.Optional(Type.Any()),
	prompt: Type.Optional(Type.Any()),
	schema: Type.Optional(Type.Any()),
	sourceFormat: Type.Optional(Type.Any()),
	include: Type.Optional(Type.Array(Type.Any())),
	extractSchema: Type.Optional(Type.Any()),
	length: Type.Optional(Type.Any()),
	markers: Type.Optional(Type.Array(Type.Any())),
	contains: Type.Optional(Type.Array(Type.Any())),
	excerpts: Type.Optional(
		Type.Array(
			Type.Object({
				needle: Type.Optional(Type.Any()),
				before: Type.Optional(Type.Any()),
				after: Type.Optional(Type.Any()),
				caseSensitive: Type.Optional(Type.Any()),
				maxOccurrences: Type.Optional(Type.Any()),
			}),
		),
	),
	regexes: Type.Optional(
		Type.Array(
			Type.Object({
				name: Type.Optional(Type.Any()),
				pattern: Type.Optional(Type.Any()),
				flags: Type.Optional(Type.Any()),
				capture: Type.Optional(Type.Any()),
				captureGroup: Type.Optional(Type.Any()),
				includeContains: Type.Optional(Type.Any()),
				maxMatches: Type.Optional(Type.Any()),
				dedupe: Type.Optional(Type.Any()),
				sort: Type.Optional(Type.Any()),
				contextBefore: Type.Optional(Type.Any()),
				contextAfter: Type.Optional(Type.Any()),
			}),
		),
	),
	mode: Type.Optional(Type.Any()),
	extract: Type.Optional(Type.Any()),
});

type Params = Static<typeof webExtractSchema>;
type ExtractAction = (typeof extractActions)[number];

export interface WebExtractToolOptions {
	modelAdapter?: ModelAdapter;
	scrapeDeps?: ScrapePipelineDeps;
}

export function createWebExtractTool(
	options: WebExtractToolOptions = {},
): WebTool<typeof webExtractSchema> {
	return defineWebTool({
		name: "web_extract",
		label: "Extract",
		description: "Vertical regex JSON/schema",
		parameters: webExtractSchema,
		async execute(_toolCallId, params: Params, signal, onUpdate) {
			const action = inferExtractAction(params);
			if (action === "list") return listDeterministicExtractors();
			if (action === "vertical")
				return runDeterministicExtractor(params, signal, onUpdate);
			if (action === "pattern")
				return runPatternInspection(params, options, signal, onUpdate);
			if (action === "surface")
				return runApiSurfaceExtraction(params, options, signal, onUpdate);
			return runAdHocExtraction(params, options, signal);
		},
		renderCall: (args, theme) =>
			renderSimpleCall("web_extract", renderExtractCallParts(args), theme),
		renderResult: (result, { expanded }) =>
			renderEnvelopeResult(result, expanded),
	});
}

export const webExtractTool = createWebExtractTool();

function inferExtractAction(params: Params): ExtractAction {
	if (params.action) return params.action as ExtractAction;
	if (!params.url && !params.content && !params.extractor) return "list";
	if (params.extract === "api-surface") return "surface";
	if (params.extractor) return "vertical";
	if (hasPatternRequest(params)) return "pattern";
	return "adhoc";
}

function renderExtractCallParts(params: Params): string[] {
	const action = inferExtractAction(params);
	if (action === "list") return ["list"];
	return [action, params.extractor, params.url ?? "provided content"].filter(
		Boolean,
	) as string[];
}

function hasPatternRequest(params: Params): boolean {
	return Boolean(
		params.sourceFormat ||
			params.include?.length ||
			params.extractSchema ||
			params.length ||
			params.markers?.length ||
			params.contains?.length ||
			params.excerpts?.length ||
			params.regexes?.length,
	);
}

async function listDeterministicExtractors() {
	const { listExtractorCapabilities } = await import("../extract/registry.js");
	const capabilities = listExtractorCapabilities();
	return toolResult({
		text: `${capabilities.length} extractor(s): ${capabilities.map((item) => item.name).join(", ")}`,
		data: capabilities,
		format: "json",
		summary: "Listed deterministic extractor capabilities.",
		assistantGuidance:
			"Use action=vertical for supported known sites, action=pattern for deterministic markers/regex/excerpts, and action=adhoc for model-backed schema extraction.",
	});
}

async function runDeterministicExtractor(
	params: Params,
	signal: AbortSignal,
	onUpdate?: Parameters<WebTool<typeof webExtractSchema>["execute"]>[3],
) {
	if (!params.extractor || !params.url) {
		return toolResult({
			text: "Provide extractor and url for vertical extraction.",
			data: undefined,
			error: {
				code: "EXTRACT_INPUT_MISSING",
				phase: "vertical_extract",
				message: "web_extract action=vertical requires both extractor and url.",
				retryable: false,
			},
		});
	}
	const config = await loadEffectiveConfig();
	await emitProgress(onUpdate, {
		state: "processing",
		url: params.url,
		message: `extractor ${params.extractor}`,
	});
	const { runVerticalExtractor } = await import("../extract/registry.js");
	const result = await runVerticalExtractor(
		params.extractor,
		params.url,
		{
			requestOptions: {
				cacheTtlSeconds: config.scrapeDefaults.cacheTtlSeconds,
				maxAgeSeconds: config.scrapeDefaults.maxAgeSeconds,
				refresh: config.scrapeDefaults.refresh,
			},
		},
		signal,
	);
	const firstSourceUrl = result.sources?.[0]?.url;
	return toolResult({
		text: verticalExtractorText(params.extractor, result),
		data: result,
		url: params.url,
		format: "json",
		sources: result.sources,
		summary: result.error
			? `${params.extractor} failed · ${params.url}`
			: `${params.extractor} done${firstSourceUrl ? ` · source: ${firstSourceUrl}` : ` · ${params.url}`}`,
		error: result.error && {
			...result.error,
			phase: "vertical_extract",
			url: params.url,
		},
		assistantGuidance: verticalExtractorGuidance(result),
	});
}

function verticalExtractorText(
	extractor: string | undefined,
	result: VerticalExtractionResult,
): string {
	const name = extractor ?? result.extractor;
	const blocked = blockedSource(result.data);
	if (blocked) {
		return [
			`${name} returned URL metadata only (${blocked.reason ?? "structured endpoint unavailable"})`,
			attemptedText(
				blocked.attemptedEndpoints ??
					result.sources?.map((source) => source.url),
			),
		]
			.filter(Boolean)
			.join("\n");
	}
	if (result.error) {
		return [
			`${name} failed (${result.error.code}): ${result.error.message}`,
			attemptedText(result.sources?.map((source) => source.url)),
		]
			.filter(Boolean)
			.join("\n");
	}
	return `${name} extracted JSON`;
}

function verticalExtractorGuidance(
	result: VerticalExtractionResult,
): string | undefined {
	const blocked = blockedSource(result.data);
	if (blocked?.reason) return blocked.reason;
	return result.error?.message;
}

function attemptedText(urls: string[] | undefined): string | undefined {
	const uniqueUrls = [...new Set(urls?.filter(Boolean) ?? [])];
	return uniqueUrls.length
		? `attempted:\n  - ${uniqueUrls.join("\n  - ")}`
		: undefined;
}

function blockedSource(
	data: unknown,
):
	| { blocked?: boolean; reason?: string; attemptedEndpoints?: string[] }
	| undefined {
	const source = (data as { source?: unknown } | undefined)?.source;
	if (!source || typeof source !== "object") return undefined;
	const typed = source as {
		blocked?: boolean;
		reason?: string;
		attemptedEndpoints?: string[];
	};
	return typed.blocked ? typed : undefined;
}

async function runPatternInspection(
	params: Params,
	options: WebExtractToolOptions,
	signal: AbortSignal,
	onUpdate?: Parameters<WebTool<typeof webExtractSchema>["execute"]>[3],
) {
	const config = await loadEffectiveConfig();
	try {
		if (params.url) {
			await emitProgress(onUpdate, {
				state: "connecting",
				url: params.url,
				message: "pattern inspection",
			});
		}
		const result = await inspectPatterns(
			{
				...config.scrapeDefaults,
				...params,
				mode: params.mode ?? config.scrapeMode,
			} as PatternInspectOptions,
			options.scrapeDeps ?? {},
			signal,
		);
		const foundMarkers =
			result.markers?.filter((item) => item.found).length ?? 0;
		const foundContains =
			result.contains?.filter((item) => item.found).length ?? 0;
		const matchCount =
			result.regexes?.reduce((total, item) => total + item.matches.length, 0) ??
			0;
		const summary = `Pattern inspection complete: ${result.source.length} chars, ${foundMarkers} marker(s), ${foundContains} contains hit(s), ${matchCount} regex match(es).`;
		return toolResult({
			text: summarizePatternInspection(result),
			data: result,
			url: result.source.url ?? params.url,
			finalUrl: result.source.finalUrl,
			status: result.source.status,
			mode: result.source.mode,
			format: result.source.sourceFormat,
			contentType: result.source.contentType,
			cache: result.source.cache,
			truncated: result.source.truncated,
			summary,
			answerContext:
				"This is deterministic text inspection. Use action=adhoc only when semantic/schema extraction needs model judgment.",
			assistantGuidance: storedResultGuidance(),
		});
	} catch (error) {
		return errorResult(
			structuredToolError(
				error,
				error instanceof PatternInspectError
					? error.structured.code
					: "PATTERN_EXTRACT_FAILED",
				"pattern_extract",
				params.url,
			),
		);
	}
}

async function runAdHocExtraction(
	params: Params,
	options: WebExtractToolOptions,
	signal: AbortSignal,
) {
	const config = await loadEffectiveConfig();
	if (!options.modelAdapter) {
		return errorResult(
			missingModelError("extract", params.url),
			"web_extract action=adhoc requires a model-backed adapter. Use action=list or action=vertical for deterministic extractors.",
		);
	}
	try {
		const { include, extractSchema, ...extractParams } = params;
		void include;
		void extractSchema;
		const result = await extractAdHoc(
			{
				...config.scrapeDefaults,
				...extractParams,
				mode: params.mode ?? config.scrapeMode,
				format: config.outputFormat,
			},
			options.modelAdapter,
			options.scrapeDeps ?? {},
			signal,
		);
		const scrape = result.input.scrape;
		const summary = `Extracted structured data from ${result.input.source}${scrape?.cache?.cached ? " using cached scrape input" : scrape ? " using fresh scrape input" : " input"}.`;
		return toolResult({
			text: summarizeExtraction(result.data),
			data: result,
			url: result.input.url ?? params.url,
			finalUrl: scrape?.finalUrl,
			status: scrape?.status,
			mode: scrape?.mode,
			format: scrape?.format,
			timing: scrape?.timing,
			truncated: scrape?.truncated,
			contentType: scrape?.contentType,
			downloadedBytes: scrape?.downloadedBytes,
			cache: scrape?.cache,
			summary,
			answerContext: `${summary} Refresh the source page before extraction when the requested facts are time-sensitive.`,
			qualitySignals: qualityFromCache(scrape?.cache),
			assistantGuidance: storedResultGuidance(),
		});
	} catch (error) {
		return errorResult(
			structuredToolError(
				error,
				error instanceof MissingExtractInputError
					? "MISSING_INPUT"
					: "EXTRACT_FAILED",
				"extract",
				params.url,
			),
		);
	}
}

function summarizeExtraction(data: unknown): string {
	if (typeof data === "string") return data.slice(0, 1200);
	return `Extracted structured data\n${JSON.stringify(data, null, 2).slice(0, 1200)}`;
}

function summarizePatternInspection(data: unknown): string {
	return `Pattern inspection\n${JSON.stringify(data, null, 2).slice(0, 1600)}`;
}
