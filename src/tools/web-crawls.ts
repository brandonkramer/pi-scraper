import { type Static, StringEnum, Type } from "@mariozechner/pi-ai";
import { type CrawlStatus, listCrawlMetadata } from "../crawl/state.js";
import { crawlStaleness } from "../storage/freshness.js";
import { defineWebTool } from "./define.js";
import { renderEnvelopeResult, renderSimpleCall } from "./render.js";
import { toolResult } from "./result.js";

const crawlStatuses = ["queued", "running", "paused", "done", "error"] as const;

export const webCrawlsSchema = Type.Object({
	seed: Type.Optional(Type.String({ description: "Optional seed URL prefix to filter prior crawls." })),
	status: Type.Optional(StringEnum(crawlStatuses, { description: "Optional crawl status filter." })),
	limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100, default: 20 })),
});

type Params = Static<typeof webCrawlsSchema>;

export const webCrawlsTool = defineWebTool({
	name: "web_crawls",
	label: "Web Crawls",
	description: "List prior local crawls from the SQLite scraper index, including staleness and recommended action.",
	parameters: webCrawlsSchema,
	async execute(_toolCallId, params: Params) {
		const crawls = await listCrawlMetadata({
			seed: params.seed,
			status: params.status as CrawlStatus | undefined,
			limit: params.limit ?? 20,
		});
		const entries = crawls.map((crawl) => {
			const freshness = crawlStaleness(crawl.updatedAt);
			return { ...crawl, ...freshness, recommendedAction: recommendedAction(crawl.status, freshness.staleness) };
		});
		return toolResult({
			text: `${entries.length} prior crawl(s)${params.seed ? ` for ${params.seed}` : ""}`,
			data: { crawls: entries },
			format: "json",
			contentType: "application/json",
		});
	},
	renderCall: (args, theme) => renderSimpleCall("web_crawls", [args.seed, args.status].filter(Boolean) as string[], theme),
	renderResult: (result, { expanded }) => renderEnvelopeResult(result, expanded),
});

function recommendedAction(status: CrawlStatus, staleness: string): string {
	if ((status === "running" || status === "paused") && staleness !== "stale" && staleness !== "expired") return "resume";
	if (status === "done" && (staleness === "fresh" || staleness === "aging")) return "reuse_results";
	if (status === "done") return "recrawl";
	if (status === "error" && (staleness === "stale" || staleness === "expired")) return "discard";
	return "inspect";
}
