/**
 * @fileoverview Pi tool adapter for crawling, crawl state, and context packages.
 */
import { type Static, Type } from "@earendil-works/pi-ai";
import { defineWebTool } from "./define.ts";
import { renderEnvelopeResult } from "../tui/envelope.ts";
import { renderWebCrawlResult } from "./web-crawl-renderers.ts";
import { renderSimpleCall } from "../tui/call.ts";
import { sessionOptionSchema, urlProperty } from "./schemas.ts";
import { crawlRun } from "./web-crawl-run.ts";
import { crawlStatus, crawlList } from "./web-crawl-status.ts";

const crawlActions = ["run", "status", "list"] as const;

export const webCrawlSchema = Type.Object({
	action: Type.Optional(Type.Any()),
	url: Type.Optional(urlProperty()),
	maxPages: Type.Optional(Type.Any()),
	maxDepth: Type.Optional(Type.Any()),
	sameOrigin: Type.Optional(Type.Any()),
	seedSitemap: Type.Optional(Type.Any()),
	crawlId: Type.Optional(Type.Any()),
	resume: Type.Optional(Type.Any()),
	seed: Type.Optional(Type.Any()),
	status: Type.Optional(Type.Any()),
	limit: Type.Optional(Type.Any()),
	concurrency: Type.Optional(Type.Any()),
	perHostConcurrency: Type.Optional(Type.Any()),
	mode: Type.Optional(Type.Any()),
	include: Type.Optional(Type.Array(Type.Any())),
	exclude: Type.Optional(Type.Array(Type.Any())),
	extract: Type.Optional(Type.Any()),
	compile: Type.Optional(Type.Any()),

	...sessionOptionSchema,
	stealth: Type.Optional(Type.Any()),
	autoWait: Type.Optional(Type.Any()),
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
		if (action === "status") return crawlStatus(params);
		if (action === "list") return crawlList(params);
		return crawlRun(params, signal, onUpdate);
	},
	renderCall: (args, theme, _context) =>
		renderSimpleCall(
			"web_crawl",
			[
				args.action,
				args.url ?? args.crawlId ?? args.seed,
				args.maxPages ? `max ${args.maxPages}` : undefined,
			].filter(Boolean) as string[],
			theme,
		),
	renderResult: (result, { expanded }, theme) =>
		isRunCrawlResult(result.details)
			? renderWebCrawlResult(result, expanded, theme)
			: renderEnvelopeResult(result, expanded),
});

function inferCrawlAction(params: Params): CrawlAction {
	if (params.action) return params.action as CrawlAction;
	if (params.crawlId && !params.url && params.resume !== true) return "status";
	if ((params.seed || params.status || params.limit) && !params.url)
		return "list";
	return "run";
}

function isRunCrawlResult(details: unknown): boolean {
	const data = (details as { data?: { metadata?: unknown } } | undefined)?.data;
	return Boolean(data && "metadata" in data);
}
