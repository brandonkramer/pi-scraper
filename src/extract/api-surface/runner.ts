/** @file API-surface extraction runner — domain logic without tool contract. */
import { loadEffectiveConfig } from "../../config.ts";
import type { ScrapePipelineDeps } from "../../scrape/pipeline.ts";
import type { ScrapeMode } from "../../types.ts";
import type { ApiSurfaceTree } from "./types.ts";

export interface ApiSurfaceInput {
	content?: string;
	url?: string;
	sourceFormat?: string;
	mode?: ScrapeMode;
}

export interface ApiSurfaceRunResult {
	tree: ApiSurfaceTree;
	source: string;
	url?: string;
}

export async function runApiSurfaceFromInput(
	input: ApiSurfaceInput,
	scrapeDeps?: ScrapePipelineDeps,
	signal?: AbortSignal,
): Promise<ApiSurfaceRunResult> {
	const { buildApiSurface } = await import("./tree.ts");
	if (input.content) {
		const tree = buildApiSurface([
			{
				url: input.url ?? "provided-content",
				title: "Provided content",
				markdown: input.sourceFormat === "html" ? undefined : input.content,
				html: input.sourceFormat === "html" ? input.content : undefined,
				text: input.content,
			},
		]);
		return { tree, source: "provided content", url: input.url };
	}
	const config = await loadEffectiveConfig();
	const { scrapeUrl } = await import("../../scrape/pipeline.ts");
	const scrape = await scrapeUrl(
		input.url as string,
		{
			...config.scrapeDefaults,
			mode: input.mode ?? config.scrapeMode,
		},
		scrapeDeps ?? {},
		signal,
	);
	const tree = buildApiSurface([
		{
			url: scrape.url ?? (input.url as string),
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
	return {
		tree,
		source: scrape.cache?.cached ? "cached scrape" : "fresh scrape",
		url: input.url,
	};
}
