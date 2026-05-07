import { type Static, StringEnum, Type } from "@mariozechner/pi-ai";
import { loadEffectiveConfig } from "../config/settings.js";
import { runCrawl } from "../crawl/runner.js";
import {
	loadCrawlMetadata,
	listCrawlMetadata,
	type CrawlMetadata,
	type CrawlStatus,
	updateCrawlMetadata,
} from "../crawl/state.js";
import { crawlStaleness } from "../storage/freshness.js";
import { updateJobManifest } from "../storage/jobs.js";
import { storeResult } from "../storage/results.js";
import type { AgenticNextAction, AgenticQualitySignals } from "../types.js";
import {
	crawlAction,
	formatAge,
	storedResultGuidance,
} from "./agentic-context.js";
import { defineWebTool } from "./define.js";
import { emitProgress } from "./progress.js";
import { renderEnvelopeResult } from "./render.js";
import { renderWebCrawlResult, renderWebToolCall } from "./web-renderers.js";
import { toolResult } from "./result.js";
import { crawlScrapeOptionSchema, urlProperty } from "./schemas.js";

const crawlActions = ["run", "status", "list"] as const;
const crawlStatuses = ["queued", "running", "paused", "done", "error"] as const;

export const webCrawlSchema = Type.Object({
	action: Type.Optional(StringEnum(crawlActions)),
	url: Type.Optional(urlProperty()),
	maxPages: Type.Optional(Type.Number()),
	maxDepth: Type.Optional(Type.Number()),
	sameOrigin: Type.Optional(Type.Boolean()),
	seedSitemap: Type.Optional(Type.Boolean()),
	crawlId: Type.Optional(Type.String()),
	resume: Type.Optional(Type.Boolean()),
	seed: Type.Optional(Type.String()),
	status: Type.Optional(Type.String()),
	limit: Type.Optional(Type.Number()),
	concurrency: Type.Optional(Type.Number()),
	perHostConcurrency: Type.Optional(Type.Number()),
	...crawlScrapeOptionSchema,
});

type Params = Static<typeof webCrawlSchema>;
type CrawlAction = (typeof crawlActions)[number];
type CrawlEntry = CrawlMetadata & {
	ageSeconds: number;
	staleness: string;
	recommendedAction: string;
};

export const webCrawlTool = defineWebTool({
	name: "web_crawl",
	label: "Crawl",
	description: "Crawl pages status/list",
	parameters: webCrawlSchema,
	async execute(_toolCallId, params: Params, signal, onUpdate) {
		const action = inferCrawlAction(params);
		if (action === "status") return crawlStatus(params);
		if (action === "list") return crawlList(params);
		return crawlRun(params, signal, onUpdate);
	},
	renderCall: (args, theme, context) =>
		renderWebToolCall(
			"web_crawl",
			[
				args.action,
				args.url ?? args.crawlId ?? args.seed,
				args.maxPages ? `max ${args.maxPages}` : undefined,
			].filter(Boolean) as string[],
			theme,
			context,
		),
	renderResult: (result, { expanded }) =>
		isRunCrawlResult(result.details)
			? renderWebCrawlResult(result, expanded)
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

async function crawlRun(
	params: Params,
	signal: AbortSignal,
	onUpdate?: Parameters<typeof emitProgress>[0],
) {
	const url = await resolveRunUrl(params);
	if (!url) {
		return toolResult({
			text: "Provide url, or crawlId with resume=true, to run a crawl.",
			data: undefined,
			error: {
				code: "CRAWL_INPUT_MISSING",
				phase: "crawl",
				message:
					"web_crawl action=run requires url, or crawlId plus resume=true for a stored crawl.",
				retryable: false,
			},
		});
	}
	const config = await loadEffectiveConfig();
	const crawl = await runCrawl(
		url,
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
	const manifest = await updateJobManifest(crawl.crawlId, {
		responseIds: [finalStored.responseId],
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
		url,
		responseId: finalStored.responseId,
		fullOutputPath: finalStored.fullOutputPath,
		truncated: true,
		diagnostics: { jobId: crawl.crawlId, jobManifestPath: manifest.path },
		assistantGuidance: storedResultGuidance(),
	});
}

async function resolveRunUrl(params: Params): Promise<string | undefined> {
	if (params.url) return params.url;
	if (!params.crawlId || params.resume !== true) return undefined;
	try {
		const metadata = await loadCrawlMetadata(params.crawlId);
		return metadata.seedUrl;
	} catch {
		return undefined;
	}
}

async function crawlStatus(params: Params) {
	if (!params.crawlId) {
		return toolResult({
			text: "Provide crawlId for crawl status.",
			data: undefined,
			error: {
				code: "CRAWL_STATUS_ID_MISSING",
				phase: "crawl",
				message: "web_crawl action=status requires crawlId.",
				retryable: false,
			},
		});
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
			summary: `Crawl ${entry.crawlId} is ${entry.status}; ${entry.recommendedAction}.`,
			answerContext: crawlAnswerContext([entry]),
			qualitySignals: crawlQuality([entry], 1),
			nextActions: crawlNextActions([entry]),
			assistantGuidance: storedResultGuidance(),
		});
	} catch (error) {
		return toolResult({
			text: `Crawl status not found: ${params.crawlId}`,
			data: undefined,
			error: {
				code: "CRAWL_STATUS_NOT_FOUND",
				phase: "crawl",
				message:
					error instanceof Error ? error.message : "Crawl status not found.",
				retryable: false,
			},
		});
	}
}

async function crawlList(params: Params) {
	const limit = params.limit ?? 20;
	const crawls = await listCrawlMetadata({
		seed: params.seed,
		status: params.status as CrawlStatus | undefined,
		limit,
	});
	const entries = crawls.map(enrichCrawl);
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
		summary: text,
		answerContext: crawlAnswerContext(entries),
		qualitySignals: crawlQuality(entries, limit),
		nextActions: crawlNextActions(entries),
		assistantGuidance:
			"Use web_crawl action=status/list before reusing crawl metadata. Treat stale or expired done crawls as seeds for action=run, not current evidence.",
	});
}

function enrichCrawl(crawl: CrawlMetadata): CrawlEntry {
	const freshness = crawlStaleness(crawl.updatedAt);
	return {
		...crawl,
		...freshness,
		recommendedAction: recommendedAction(crawl.status, freshness.staleness),
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
