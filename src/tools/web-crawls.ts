import { type Static, StringEnum, Type } from "@mariozechner/pi-ai";
import {
	type CrawlMetadata,
	type CrawlStatus,
	listCrawlMetadata,
} from "../crawl/state.js";
import { crawlStaleness } from "../storage/freshness.js";
import type { AgenticNextAction, AgenticQualitySignals } from "../types.js";
import {
	crawlAction,
	formatAge,
	retrieveResultAction,
	storedResultGuidance,
} from "./agentic-context.js";
import { defineWebTool } from "./define.js";
import { renderSimpleCall } from "./render.js";
import { renderWebCrawlsResult } from "./web-renderers.js";
import { toolResult } from "./result.js";

const crawlStatuses = ["queued", "running", "paused", "done", "error"] as const;

export const webCrawlsSchema = Type.Object({
	seed: Type.Optional(
		Type.String({
			description: "Seed URL prefix filter.",
		}),
	),
	status: Type.Optional(StringEnum(crawlStatuses)),
	limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100, default: 20 })),
});

type Params = Static<typeof webCrawlsSchema>;

type CrawlEntry = CrawlMetadata & {
	ageSeconds: number;
	staleness: string;
	recommendedAction: string;
};

export const webCrawlsTool = defineWebTool({
	name: "web_crawls",
	label: "Web Crawls",
	description: "List prior local crawls with staleness and recommended action.",
	parameters: webCrawlsSchema,
	async execute(_toolCallId, params: Params) {
		const crawls = await listCrawlMetadata({
			seed: params.seed,
			status: params.status as CrawlStatus | undefined,
			limit: params.limit ?? 20,
		});
		const entries = crawls.map((crawl) => {
			const freshness = crawlStaleness(crawl.updatedAt);
			return {
				...crawl,
				...freshness,
				recommendedAction: recommendedAction(crawl.status, freshness.staleness),
			};
		});
		const shaped = shapeCrawls(entries, params);
		return toolResult({
			text: shaped.text,
			data: { crawls: entries },
			format: "json",
			contentType: "application/json",
			...shaped.context,
		});
	},
	renderCall: (args, theme) =>
		renderSimpleCall(
			"web_crawls",
			[args.seed, args.status].filter(Boolean) as string[],
			theme,
		),
	renderResult: (result, { expanded }) =>
		renderWebCrawlsResult(result, expanded),
});

function shapeCrawls(entries: CrawlEntry[], params: Params) {
	const scope = params.seed ? ` for ${params.seed}` : "";
	if (entries.length === 0) {
		return {
			text: `No prior crawls${scope}.`,
			context: {
				summary: `No prior crawls${scope}.`,
				answerContext: `No crawl metadata matched the requested filters${scope}. Start a fresh web_crawl if site-level context is needed.`,
				qualitySignals: {
					confidence: "high",
					freshness: "unknown",
					coverage: "complete",
				} satisfies AgenticQualitySignals,
				nextActions: [] as AgenticNextAction[],
				assistantGuidance: storedResultGuidance(),
			},
		};
	}
	const latest = entries[0]!;
	const actionCounts = countActions(entries);
	const text = `Found ${entries.length} prior crawl(s)${scope}. Latest ${latest.crawlId} is ${latest.staleness}; recommended action: ${latest.recommendedAction}.`;
	return {
		text,
		context: {
			summary: `${text} ${actionSummary(actionCounts)}`.trim(),
			answerContext: crawlAnswerContext(entries),
			qualitySignals: crawlQuality(entries, params.limit ?? 20),
			nextActions: crawlNextActions(entries),
			assistantGuidance:
				"Use crawl staleness and recommendedAction before reusing stored crawl results. Treat stale or expired done crawls as seeds for a new crawl, not current evidence.",
		},
	};
}

function crawlAnswerContext(entries: CrawlEntry[]): string {
	return [
		"Recent crawl history:",
		...entries
			.slice(0, 5)
			.map(
				(entry) =>
					`- ${entry.crawlId}: ${entry.status}, ${entry.visitedCount} visited, ${entry.succeededCount} succeeded, ${entry.failedCount} failed, updated ${formatAge(entry.ageSeconds)}, staleness ${entry.staleness}, recommendedAction ${entry.recommendedAction}${entry.responseId ? `, responseId ${entry.responseId}` : ""}`,
			),
	].join("\n");
}

function crawlNextActions(entries: CrawlEntry[]): AgenticNextAction[] {
	const actions: AgenticNextAction[] = [];
	for (const entry of entries.slice(0, 5)) {
		if (entry.recommendedAction === "resume") {
			actions.push(
				crawlAction(entry.seedUrl, `Resume crawl ${entry.crawlId}.`, {
					crawlId: entry.crawlId,
					resume: true,
				}),
			);
		} else if (entry.recommendedAction === "recrawl") {
			actions.push(
				crawlAction(entry.seedUrl, `Recrawl stale crawl ${entry.crawlId}.`, {
					resume: false,
				}),
			);
		} else if (entry.responseId) {
			actions.push(
				retrieveResultAction(
					entry.responseId,
					`Retrieve stored output for crawl ${entry.crawlId}.`,
				),
			);
		}
	}
	return actions.slice(0, 5);
}

function crawlQuality(
	entries: CrawlEntry[],
	limit: number,
): AgenticQualitySignals {
	const stale = entries.filter(
		(entry) => entry.staleness === "stale" || entry.staleness === "expired",
	);
	return {
		confidence: stale.length ? "medium" : "high",
		freshness: stale.length ? "stale_possible" : "current",
		coverage: entries.length >= limit ? "top_n_only" : "complete",
		knownGaps: stale.length
			? [
					`${stale.length} crawl(s) are stale or expired and should not be treated as current.`,
				]
			: undefined,
	};
}

function recommendedAction(status: CrawlStatus, staleness: string): string {
	if (
		(status === "running" || status === "paused") &&
		staleness !== "stale" &&
		staleness !== "expired"
	)
		return "resume";
	if (status === "done" && (staleness === "fresh" || staleness === "aging"))
		return "reuse_results";
	if (status === "done") return "recrawl";
	if (status === "error" && (staleness === "stale" || staleness === "expired"))
		return "discard";
	return "inspect";
}

function countActions(entries: CrawlEntry[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const entry of entries)
		counts.set(
			entry.recommendedAction,
			(counts.get(entry.recommendedAction) ?? 0) + 1,
		);
	return counts;
}

function actionSummary(counts: Map<string, number>): string {
	return Array.from(counts.entries())
		.map(([action, count]) => `${count} ${action}`)
		.join("; ");
}
