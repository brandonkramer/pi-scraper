/**
 * @fileoverview Pi tool adapter for crawling, crawl state, and context packages.
 */
import { type Static, Type } from "@earendil-works/pi-ai";
import { loadEffectiveConfig } from "../config/settings.js";
import { runCrawl } from "../crawl/runner.js";
import {
	loadCrawlMetadata,
	listCrawlMetadata,
	type CrawlMetadata,
	type CrawlStatus,
	updateCrawlMetadata,
} from "../crawl/state.js";
import {
	aggregateFreshness,
	crawlStaleness,
	freshnessFromTimestamp,
} from "../storage/freshness.js";
import type { ScrapeResult } from "../scrape/pipeline.js";
import { updateJobManifest } from "../storage/jobs.js";
import { storeResultWithResponseId } from "../storage/results.js";
import type {
	AgenticNextAction,
	AgenticQualitySignals,
	FreshnessMetadata,
} from "../types.js";
import {
	crawlAction,
	formatAge,
	storedResultGuidance,
} from "./agentic-context.js";
import { buildStoredContextPackage } from "./context-package.js";
import {
	buildSessionNotice,
	buildSessionText,
	deleteSessionAndStorage,
	saveSessionToStorage,
} from "../http/session.js";
import { defineWebTool } from "./define.js";
import { emitProgress } from "./progress.js";
import {
	batchProgressFromCrawlPages,
	cloneBatchProgress,
	type BatchProgressView,
	updateUrlBatchProgress,
} from "./web-batch-progress-renderer.js";
import { renderEnvelopeResult } from "./render.js";
import { renderWebCrawlResult, renderWebToolCall } from "./web-renderers.js";
import { toolResult } from "./result.js";
import { sessionOptionSchema, urlProperty } from "./schemas.js";

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

type Params = Static<typeof webCrawlSchema>;
type CrawlAction = (typeof crawlActions)[number];
type CrawlEntry = CrawlMetadata & {
	ageSeconds: number;
	staleness: string;
	freshness: FreshnessMetadata;
	recommendedAction: string;
};

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
	const progressView: BatchProgressView = {
		total: Number(params.maxPages ?? params.limit ?? 1) || 1,
		completed: 0,
		succeeded: 0,
		failed: 0,
		concurrency: Number(params.concurrency ?? 1) || 1,
		items: [{ url, status: "queued" }],
		label: "web_crawl",
	};
	const crawl = await runCrawl(
		url,
		{
			...config.scrapeDefaults,
			...params,
			mode: params.mode ?? config.scrapeMode,
			format: config.outputFormat,
			onProgress: (progress) => {
				updateUrlBatchProgress(progressView, progress.state, progress.url);
				if (progress.total) progressView.total = progress.total;
				void emitProgress(onUpdate, {
					state: progress.state,
					current: progress.current,
					total: progress.total,
					url: progress.url,
					message: progress.message,
					data: {
						metadata: progress.metadata,
						batchProgress: cloneBatchProgress(progressView),
					},
				});
			},
		},
		{},
		signal,
	);
	const apiSurface = await maybeBuildApiSurface(params, crawl.pages);
	const { metadata: finalStored } = await storeResultWithResponseId(
		(responseId) => {
			crawl.metadata = { ...crawl.metadata, responseId };
			return apiSurface ? { ...crawl, apiSurface } : crawl;
		},
	);
	crawl.metadata = await updateCrawlMetadata(crawl.crawlId, {
		responseId: finalStored.responseId,
		status: crawl.metadata.status,
	});
	const contextPackage = await buildCrawlContextPackage(
		params,
		crawl.crawlId,
		crawl.pages,
	);
	const responseIds = contextPackage?.responseId
		? [finalStored.responseId, contextPackage.responseId]
		: [finalStored.responseId];
	const manifest = await updateJobManifest(crawl.crawlId, { responseIds });
	const freshness = crawlFreshness(
		crawl.metadata,
		config.scrapeDefaults.maxAgeSeconds,
	);
	const surfaceText = apiSurface
		? ` apiSurface: ${apiSurface.modules.length} module(s).`
		: "";
	const packageText = contextPackage
		? ` package: ${contextPackage.value.package.urlCount} page(s), packageResponseId: ${contextPackage.responseId}.`
		: "";
	const text = `Crawl ${crawl.crawlId}: ${crawl.metadata.succeededCount} succeeded, ${crawl.metadata.failedCount} failed, ${crawl.metadata.visitedCount} visited, frontier ${crawl.metadata.frontierCount}.${surfaceText}${packageText} responseId: ${finalStored.responseId}`;
	if (params.sessionId) {
		if (params.saveSession) await saveSessionToStorage(params.sessionId);
		if (params.clearSession) await deleteSessionAndStorage(params.sessionId);
	}
	const sessionNotice = buildSessionNotice(params);
	const sessionSuffix = buildSessionText(params);
	return toolResult({
		text: text + sessionSuffix,
		data: {
			crawlId: crawl.crawlId,
			pages: crawl.pages,
			visited: crawl.visited,
			statePath: crawl.statePath,
			metadata: crawl.metadata,
			apiSurface,
			contextPackage: contextPackage?.value,
		},
		url,
		responseId: finalStored.responseId,
		fullOutputPath: finalStored.fullOutputPath,
		truncated: true,
		freshness,
		diagnostics: {
			sessionNotice: sessionNotice || undefined,
			batchProgress: batchProgressFromCrawlPages(crawl.pages),
			jobId: crawl.crawlId,
			jobManifestPath: manifest.path,
			contextPackage: contextPackage && {
				responseId: contextPackage.responseId,
				fullOutputPath: contextPackage.fullOutputPath,
				crawlPackagePath: contextPackage.crawlPackagePath,
			},
		},
		assistantGuidance: storedResultGuidance(),
	});
}

async function maybeBuildApiSurface(params: Params, pages: ScrapeResult[]) {
	if (params.extract !== "api-surface") return undefined;
	const { buildApiSurfaceFromScrapes } = await import(
		"../extract/api-surface.js"
	);
	return buildApiSurfaceFromScrapes(pages);
}

async function buildCrawlContextPackage(
	params: Params,
	crawlId: string,
	pages: ScrapeResult[],
) {
	if (params.compile !== true) return undefined;
	return buildStoredContextPackage({
		source: "crawl",
		crawlId,
		pages: pages.map((result) => ({
			url: result.finalUrl ?? result.url ?? "",
			result,
		})),
		persistCrawlPackage: true,
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
			freshness: entry.freshness,
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

function crawlFreshness(
	crawl: CrawlMetadata,
	maxAgeSeconds?: number,
): FreshnessMetadata {
	return (
		freshnessFromTimestamp(crawl.updatedAt, maxAgeSeconds) ?? {
			cachedAt: crawl.updatedAt,
			stale: false,
		}
	);
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
