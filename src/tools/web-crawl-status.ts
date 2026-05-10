/**
 * @fileoverview web_crawl action="status" and action="list" handlers — crawl metadata lookup, enrichment, and agentic guidance.
 */
import {
	loadCrawlMetadata,
	listCrawlMetadata,
	type CrawlMetadata,
	type CrawlStatus,
} from "../crawl/state.ts";
import { aggregateFreshness, crawlStaleness } from "../storage/cache/freshness.ts";
import type {
	AgenticNextAction,
	AgenticQualitySignals,
	FreshnessMetadata,
} from "../types.ts";
import { crawlAction, storedResultGuidance } from "./agentic-context.ts";
import { formatAge } from "../scrape/describe.ts";
import { inputErrorResult, toolResult } from "./result.ts";
import { crawlFreshness } from "./web-crawl-run.ts";
import type { Params } from "./web-crawl.ts";

export type CrawlEntry = CrawlMetadata & {
	ageSeconds: number;
	staleness: string;
	freshness: FreshnessMetadata;
	recommendedAction: string;
};

export async function crawlStatus(params: Params) {
	if (!params.crawlId) {
		return inputErrorResult(
			"CRAWL_STATUS_ID_MISSING",
			"crawl",
			"web_crawl action=status requires crawlId.",
			"Provide crawlId for crawl status.",
		);
	}
	try {
		const metadata = await loadCrawlMetadata(params.crawlId);
		const entry = enrichCrawl(metadata);
		const done = entry.succeededCount + entry.failedCount;
		return toolResult({
			text: `Crawl ${entry.crawlId}: ${entry.status} · ${done} page(s) processed · ${entry.failedCount} failed · frontier ${entry.frontierCount} · ${entry.staleness}; recommended action: ${entry.recommendedAction}`,
			data: entry,
			url: entry.seedUrl,
			responseId: entry.responseId,
			format: "json",
			contentType: "application/json",
			freshness: entry.freshness,
			summary: `Crawl ${entry.crawlId} is ${entry.status}; ${entry.recommendedAction}.`,
			answerContext: crawlAnswerContext([entry]),
			qualitySignals: crawlQuality([entry], 1),
			nextActions: crawlNextActions([entry]),
			assistantGuidance: storedResultGuidance(),
		});
	} catch (error) {
		return inputErrorResult(
			"CRAWL_STATUS_NOT_FOUND",
			"crawl",
			error instanceof Error ? error.message : "Crawl status not found.",
			`Crawl status not found: ${params.crawlId}`,
		);
	}
}

export async function crawlList(params: Params) {
	const limit = params.limit ?? 20;
	const crawls = await listCrawlMetadata({
		seed: params.seed,
		status: params.status as CrawlStatus | undefined,
		limit,
	});
	const entries = crawls.map((crawl) => enrichCrawl(crawl));
	const scope = params.seed ? ` for ${params.seed}` : "";
	if (entries.length === 0) {
		return toolResult({
			text: `No prior crawls${scope}.`,
			data: { crawls: entries },
			format: "json",
			contentType: "application/json",
			summary: `No prior crawls${scope}.`,
			answerContext: `No crawl metadata matched the requested filters${scope}. Start a fresh web_crawl action=run if site-level context is needed.`,
			qualitySignals: {
				confidence: "high",
				freshness: "unknown",
				coverage: "complete",
			} satisfies AgenticQualitySignals,
			assistantGuidance: storedResultGuidance(),
		});
	}
	const latest = entries[0]!;
	const text = `Found ${entries.length} prior crawl(s)${scope}. Latest ${latest.crawlId} is ${latest.staleness}; recommended action: ${latest.recommendedAction}.`;
	return toolResult({
		text,
		data: { crawls: entries },
		format: "json",
		contentType: "application/json",
		freshness: aggregateFreshness(entries.map((entry) => entry.freshness)),
		summary: text,
		answerContext: crawlAnswerContext(entries),
		qualitySignals: crawlQuality(entries, limit),
		nextActions: crawlNextActions(entries),
		assistantGuidance:
			"Use web_crawl action=status/list before reusing crawl metadata. Treat stale or expired done crawls as seeds for action=run, not current evidence.",
	});
}

function enrichCrawl(crawl: CrawlMetadata, maxAgeSeconds?: number): CrawlEntry {
	const staleness = crawlStaleness(crawl.updatedAt);
	const freshness = crawlFreshness(crawl, maxAgeSeconds);
	return {
		...crawl,
		...staleness,
		freshness,
		recommendedAction: recommendedAction(crawl.status, staleness.staleness),
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

function crawlAnswerContext(entries: CrawlEntry[]): string {
	return [
		"Recent crawl metadata:",
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
					action: "run",
					crawlId: entry.crawlId,
					resume: true,
				}),
			);
		} else if (entry.recommendedAction === "recrawl") {
			actions.push(
				crawlAction(entry.seedUrl, `Recrawl stale crawl ${entry.crawlId}.`, {
					action: "run",
					resume: false,
				}),
			);
		} else {
			actions.push({
				action: "inspect",
				tool: "web_crawl",
				params: { action: "status", crawlId: entry.crawlId },
				description: `Inspect crawl ${entry.crawlId}.`,
			});
		}
	}
	return actions.slice(0, 5);
}

function crawlQuality(
	entries: CrawlEntry[],
	limit: number,
): AgenticQualitySignals {
	const stale = entries.filter(
		(entry) =>
			entry.freshness.stale ||
			entry.staleness === "stale" ||
			entry.staleness === "expired",
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
