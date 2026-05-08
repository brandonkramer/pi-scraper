/** @fileoverview API-surface execution path for web_extract kept outside the thin tool adapter. */
import { loadEffectiveConfig } from "../config/settings.js";
import type { ApiSurfaceTree } from "../extract/api-surface.js";
import type { ScrapePipelineDeps } from "../scrape/pipeline.js";
import type { CommonScrapeOptions } from "../types.js";
import { storedResultGuidance } from "./agentic-context.js";
import type { ToolUpdate } from "./define.js";
import { emitProgress } from "./progress.js";
import { toolResult } from "./result.js";

export interface WebExtractSurfaceOptions {
	scrapeDeps?: ScrapePipelineDeps;
}

export interface WebExtractSurfaceParams
	extends Omit<CommonScrapeOptions, "include"> {
	url?: string;
	content?: string;
	sourceFormat?: string;
	include?: unknown;
	extractSchema?: unknown;
	extract?: unknown;
}

export async function runApiSurfaceExtraction(
	params: WebExtractSurfaceParams,
	options: WebExtractSurfaceOptions,
	signal: AbortSignal,
	onUpdate?: ToolUpdate,
) {
	if (!params.url && !params.content) {
		return toolResult({
			text: "Provide url or content for web_extract extract=api-surface.",
			data: undefined,
			error: {
				code: "API_SURFACE_INPUT_MISSING",
				phase: "api_surface_extract",
				message: "web_extract extract=api-surface requires url or content.",
				retryable: false,
			},
		});
	}
	const { buildApiSurface } = await import("../extract/api-surface.js");
	if (params.content) {
		const tree = buildApiSurface([
			{
				url: params.url ?? "provided-content",
				title: "Provided content",
				markdown: params.sourceFormat === "html" ? undefined : params.content,
				html: params.sourceFormat === "html" ? params.content : undefined,
				text: params.content,
			},
		]);
		return apiSurfaceResult(tree, params.url, "provided content");
	}
	const config = await loadEffectiveConfig();
	await emitProgress(onUpdate, {
		state: "processing",
		url: params.url,
		message: "api-surface extraction",
	});
	const { scrapeUrl } = await import("../scrape/pipeline.js");
	const {
		include,
		extractSchema,
		extract,
		content,
		sourceFormat,
		...scrapeParams
	} = params;
	void include;
	void extractSchema;
	void extract;
	void content;
	void sourceFormat;
	const scrape = await scrapeUrl(
		params.url as string,
		{
			...config.scrapeDefaults,
			...scrapeParams,
			mode: params.mode ?? config.scrapeMode,
			format: config.outputFormat,
		},
		options.scrapeDeps ?? {},
		signal,
	);
	const tree = buildApiSurface([
		{
			url: scrape.url ?? (params.url as string),
			finalUrl: scrape.finalUrl,
			title: scrape.data.title,
			description: scrape.data.description,
			html: scrape.data.html,
			markdown: scrape.data.markdown,
			text: scrape.data.text,
			data: scrape.data.json,
			error: scrape.error && {
				code: scrape.error.code,
				message: scrape.error.message,
			},
		},
	]);
	return apiSurfaceResult(
		tree,
		params.url,
		scrape.cache?.cached ? "cached scrape" : "fresh scrape",
	);
}

function apiSurfaceResult(
	tree: ApiSurfaceTree,
	url: string | undefined,
	source: string,
) {
	const symbolCount = tree.modules.reduce(
		(total, item) =>
			total + item.functions.length + (item.classes?.length ?? 0),
		0,
	);
	return toolResult({
		text: `API surface extracted from ${source}: ${tree.modules.length} module(s), ${symbolCount} symbol(s).`,
		data: tree,
		url,
		format: "json",
		summary: `API surface: ${tree.modules.length} module(s).`,
		answerContext: tree.fallback
			? `${tree.fallback.reason} Use code-adjacent parsers or narrower symbol filters when available for richer raw-code docs.`
			: "Hierarchical API-surface extraction from already fetched documentation content.",
		assistantGuidance: storedResultGuidance(),
	});
}
