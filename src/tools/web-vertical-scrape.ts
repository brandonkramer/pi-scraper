import { type Static, StringEnum, Type } from "@mariozechner/pi-ai";
import { runVerticalExtractor } from "../extract/registry.js";
import { defineWebTool } from "./define.js";
import { emitProgress } from "./progress.js";
import { renderEnvelopeResult, renderSimpleCall } from "./render.js";
import { toolResult } from "./result.js";
import { urlProperty } from "./schemas.js";

const extractorNames = [
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
] as const;

export const webVerticalScrapeSchema = Type.Object({
	extractor: StringEnum(extractorNames, {
		description: "Named deterministic vertical extractor.",
	}),
	url: urlProperty("URL supported by the selected extractor."),
	cacheTtlSeconds: Type.Optional(Type.Number({ minimum: 1, description: "Opt-in fetch cache TTL in seconds for extractor API/page fetches." })),
	maxAgeSeconds: Type.Optional(Type.Number({ minimum: 1 })),
	refresh: Type.Optional(Type.Boolean()),
});

type Params = Static<typeof webVerticalScrapeSchema>;

export const webVerticalScrapeTool = defineWebTool({
	name: "web_vertical_scrape",
	label: "Web Vertical Scrape",
	description:
		"Run a known-site extractor returning typed JSON. Current extractors prefer public APIs/feeds and declare browser/cloud/LLM requirements.",
	parameters: webVerticalScrapeSchema,
	async execute(_toolCallId, params: Params, signal, onUpdate) {
		await emitProgress(onUpdate, {
			state: "processing",
			url: params.url,
			message: `extractor ${params.extractor}`,
		});
		const result = await runVerticalExtractor(
			params.extractor,
			params.url,
			{ requestOptions: { cacheTtlSeconds: params.cacheTtlSeconds, maxAgeSeconds: params.maxAgeSeconds, refresh: params.refresh } },
			signal,
		);
		return toolResult({
			text: result.error
				? `${params.extractor} failed: ${result.error.message}`
				: `${params.extractor} extracted JSON`,
			data: result,
			url: params.url,
			format: "json",
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
