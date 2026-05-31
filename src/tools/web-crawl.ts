/** @file Pi tool adapter for crawling, crawl state, and context. */
import { type Static, Type } from "typebox";

import { toolCall } from "../tui/index.ts";
import { renderWebCrawlLookupResult, renderWebCrawlResult } from "../tui/renderers/crawl.ts";
import { defineWebTool } from "./infra/define.ts";
import { scrapeModeOptionSchema, sessionOptionSchema, urlProperty } from "./infra/schemas.ts";
import { crawlRun } from "./web-crawl-run.ts";
import { crawlStatus, crawlList } from "./web-crawl-status.ts";

const crawlActions = ["run", "status", "list"] as const;
const crawlActionSchema = Type.Unsafe<"run" | "status" | "list">({ type: "string", enum: ["run", "status", "list"] });

export const webCrawlSchema = Type.Object({
	action: Type.Optional(crawlActionSchema),
	url: Type.Optional(urlProperty()),
	maxPages: Type.Optional(Type.Integer()),
	maxDepth: Type.Optional(Type.Integer()),
	sameOrigin: Type.Optional(Type.Boolean()),
	seedSitemap: Type.Optional(Type.Boolean()),
	crawlId: Type.Optional(Type.String()),
	resume: Type.Optional(Type.Boolean()),
	seed: Type.Optional(Type.String()),
	status: Type.Optional(Type.String()),
	limit: Type.Optional(Type.Integer()),
	strategy: Type.Optional(
		Type.Unsafe<"bfs" | "dfs" | "best-first">({ type: "string", enum: ["bfs", "dfs", "best-first"] }),
	),
	proxy: Type.Optional(Type.Union([Type.String(), Type.Array(Type.String())])),
	concurrency: Type.Optional(Type.Integer()),
	perHostConcurrency: Type.Optional(Type.Integer()),
	...scrapeModeOptionSchema,
	include: Type.Optional(Type.Array(Type.String())),
	exclude: Type.Optional(Type.Array(Type.String())),
	extract: Type.Optional(Type.String()),
	compile: Type.Optional(Type.Boolean()),

	...sessionOptionSchema,
	stealth: Type.Optional(Type.Boolean()),
	autoWait: Type.Optional(Type.Boolean()),
});

export type Params = Static<typeof webCrawlSchema>;
type CrawlAction = (typeof crawlActions)[number];
export const webCrawlTool = defineWebTool({
	name: "web_crawl",
	label: "Crawl",
	description: "Crawl pages/status",
	parameters: webCrawlSchema,
	async execute(_toolCallId, params: Params, signal, onUpdate) {
		const action = inferCrawlAction(params);
		if (action === "status") return await crawlStatus(params);
		if (action === "list") return await crawlList(params);
		return await crawlRun(params, signal, onUpdate);
	},
	renderCall: (args, theme, _context) =>
		toolCall(
			"web_crawl",
			[
				args.action,
				args.url ?? args.crawlId ?? args.seed,
				args.maxPages ? `max ${String(args.maxPages)}` : undefined,
			].filter(Boolean) as string[],
			theme,
		),
	renderResult: (result, { expanded }, theme) =>
		isRunCrawlResult(result.details)
			? renderWebCrawlResult(result, expanded, theme)
			: renderWebCrawlLookupResult(result, expanded, theme),
});

function inferCrawlAction(params: Params): CrawlAction {
	if (params.action) return params.action;
	if (params.crawlId && !params.url && params.resume !== true) return "status";
	if ((params.seed || params.status || params.limit) && !params.url) return "list";
	return "run";
}

function isRunCrawlResult(details: unknown): boolean {
	const data = (details as { data?: { metadata?: unknown } } | undefined)?.data;
	return Boolean(data && "metadata" in data);
}
