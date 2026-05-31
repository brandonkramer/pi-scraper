import type { ApiSurfaceTree } from "../extract/api-surface/index.ts";
import { runApiSurfaceFromInput, type ApiSurfaceInput } from "../extract/api-surface/runner.ts";
import type { ScrapePipelineDeps } from "../scrape/pipeline.ts";
import type { CommonScrapeOptions } from "../types.ts";
import { storedResultGuidance } from "./infra/agentic-context.ts";
/** @file API-surface execution path for web_extract kept outside the thin tool adapter. */
import type { ToolUpdate } from "./infra/define.ts";
import { emitProgress } from "./infra/progress.ts";
import { inputErrorResult, toolResult } from "./infra/result.ts";

export interface WebExtractSurfaceOptions {
	scrapeDeps?: ScrapePipelineDeps;
}

export interface WebExtractSurfaceParams extends Omit<CommonScrapeOptions, "include"> {
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
		return inputErrorResult(
			"API_SURFACE_INPUT_MISSING",
			"api_surface_extract",
			"web_extract extract=api-surface requires url or content.",
			"Provide url or content for web_extract extract=api-surface.",
		);
	}
	await emitProgress(onUpdate, {
		state: "processing",
		url: params.url,
		message: "api-surface extraction",
	});
	const { include, extractSchema, extract, ...rest } = params;
	void include;
	void extractSchema;
	void extract;
	const { tree, source, url } = await runApiSurfaceFromInput(
		rest as ApiSurfaceInput,
		options.scrapeDeps,
		signal,
	);
	return apiSurfaceResult(tree, url, source);
}

function apiSurfaceResult(tree: ApiSurfaceTree, url: string | undefined, source: string) {
	const symbolCount = tree.modules.reduce(
		(total, item) => total + item.functions.length + (item.classes?.length ?? 0),
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
