import { type Static, Type } from "@mariozechner/pi-ai";
import { loadEffectiveConfig } from "../config/settings.js";
import { runCrawl } from "../crawl/runner.js";
import { updateCrawlMetadata } from "../crawl/state.js";
import { storeResult } from "../storage/results.js";
import { defineWebTool } from "./define.js";
import { emitProgress } from "./progress.js";
import { renderWebCrawlResult, renderWebToolCall } from "./web-renderers.js";
import { toolResult } from "./result.js";
import { crawlScrapeOptionSchema, urlProperty } from "./schemas.js";

export const webCrawlSchema = Type.Object({
	url: urlProperty("Seed URL."),
	maxPages: Type.Optional(Type.Number({ minimum: 1, maximum: 1000 })),
	maxDepth: Type.Optional(Type.Number({ minimum: 0, maximum: 20 })),
	sameOrigin: Type.Optional(Type.Boolean()),
	seedSitemap: Type.Optional(Type.Boolean()),
	crawlId: Type.Optional(
		Type.String({
			description: "Stable crawl id for resume/storage.",
		}),
	),
	resume: Type.Optional(
		Type.Boolean({
			description: "Resume crawlId state; false restarts.",
		}),
	),
	concurrency: Type.Optional(Type.Number({ minimum: 1, maximum: 32 })),
	perHostConcurrency: Type.Optional(Type.Number({ minimum: 1, maximum: 16 })),
	...crawlScrapeOptionSchema,
});

type Params = Static<typeof webCrawlSchema>;

export const webCrawlTool = defineWebTool({
	name: "web_crawl",
	label: "Web Crawl",
	description:
		"Crawl linked pages from a seed URL; depth/page limits, robots, resume, compact stored results.",
	parameters: webCrawlSchema,
	async execute(_toolCallId, params: Params, signal, onUpdate) {
		const config = await loadEffectiveConfig();
		const crawl = await runCrawl(
			params.url,
			{
				...config.scrapeDefaults,
				...params,
				mode: params.mode ?? config.scrapeMode,
				format: config.outputFormat,
				onProgress: (progress) =>
					void emitProgress(onUpdate, {
						state: progress.state,
						current: progress.current,
						total: progress.total,
						url: progress.url,
						message: progress.message,
						data: progress.metadata,
					}),
			},
			{},
			signal,
		);
		const stored = await storeResult(crawl);
		crawl.metadata = await updateCrawlMetadata(crawl.crawlId, {
			responseId: stored.responseId,
			status: crawl.metadata.status,
		});
		const finalStored = await storeResult(crawl, {
			responseId: stored.responseId,
		});
		const text = `Crawl ${crawl.crawlId}: ${crawl.metadata.succeededCount} succeeded, ${crawl.metadata.failedCount} failed, ${crawl.metadata.visitedCount} visited, frontier ${crawl.metadata.frontierCount}. responseId: ${finalStored.responseId}`;
		return toolResult({
			text,
			data: {
				crawlId: crawl.crawlId,
				pages: crawl.pages,
				visited: crawl.visited,
				statePath: crawl.statePath,
				metadata: crawl.metadata,
			},
			url: params.url,
			responseId: finalStored.responseId,
			fullOutputPath: finalStored.fullOutputPath,
			truncated: true,
		});
	},
	renderCall: (args, theme, context) =>
		renderWebToolCall(
			"web_crawl",
			[
				args.url,
				`max ${args.maxPages ?? 50}`,
				args.crawlId ? `crawlId ${args.crawlId}` : undefined,
			].filter(Boolean) as string[],
			theme,
			context,
		),
	renderResult: (result, { expanded }) =>
		renderWebCrawlResult(result, expanded),
});
