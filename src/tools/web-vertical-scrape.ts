import { type Static, StringEnum, Type } from "@mariozechner/pi-ai";
import { loadEffectiveConfig } from "../config/settings.js";
import { runVerticalExtractor } from "../extract/registry.js";
import { defineWebTool } from "./define.js";
import { emitProgress } from "./progress.js";
import { renderEnvelopeResult, renderSimpleCall } from "./render.js";
import { toolResult } from "./result.js";
import { urlProperty } from "./schemas.js";

export const extractorNames = [
	"github_repo",
	"github_issue",
	"github_pr",
	"github_release",
	"npm",
	"pypi",
	"crates_io",
	"docker_hub",
	"huggingface_model",
	"huggingface_dataset",
	"hackernews",
	"arxiv",
	"deepwiki",
	"ossinsight_collections",
	"ossinsight_collection_ranking",
	"ossinsight_trending_repos",
	"ossinsight_repo_analytics",
] as const;

export const webVerticalScrapeSchema = Type.Object({
	extractor: StringEnum(extractorNames),
	url: urlProperty("Supported URL."),
});

type Params = Static<typeof webVerticalScrapeSchema>;

export const webVerticalScrapeTool = defineWebTool({
	name: "web_vertical_scrape",
	label: "Web Vertical Scrape",
	description:
		"Run deterministic known-site extractor returning typed JSON from APIs/feeds when available.",
	parameters: webVerticalScrapeSchema,
	async execute(_toolCallId, params: Params, signal, onUpdate) {
		const config = await loadEffectiveConfig();
		await emitProgress(onUpdate, {
			state: "processing",
			url: params.url,
			message: `extractor ${params.extractor}`,
		});
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
			text: result.error
				? `${params.extractor} failed: ${result.error.message}`
				: `${params.extractor} extracted JSON`,
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
		});
	},
	renderCall: (args, theme) =>
		renderSimpleCall("web_vertical_scrape", [args.extractor, args.url], theme),
	renderResult: (result, { expanded }) =>
		renderEnvelopeResult(result, expanded),
});
