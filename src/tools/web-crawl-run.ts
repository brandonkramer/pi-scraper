/**
 * @file Web_crawl action="run" handler — crawl execution, API-surface building, context packaging,
 *   and URL resolution.
 */
import {
	cloneBatchProgress,
	type BatchProgressView,
	batchProgressFromCrawlPages,
	updateUrlBatchProgress,
} from "../batch/progress-state.ts";
import { loadEffectiveConfig } from "../config.ts";
import { runCrawl } from "../crawl/runner.ts";
import {
	formatCrawlStrategyLabel,
	loadCrawlMetadata,
	updateCrawlMetadata,
	type CrawlMetadata,
} from "../crawl/state.ts";
import { resolveProxyParam } from "../http/proxy-pool.ts";
import type { ScrapeResult } from "../scrape/pipeline.ts";
import { freshnessFromTimestamp } from "../storage/cache/freshness.ts";
import { storeCompiledContext } from "../storage/context/build.ts";
import { updateJobManifest } from "../storage/jobs/manifest.ts";
import { storeResponseWithId } from "../storage/responses/store.ts";
import type { FreshnessMetadata } from "../types.ts";
import { storedResultGuidance } from "./infra/agentic-context.ts";
import type { ToolUpdate } from "./infra/define.ts";
import { emitProgress } from "./infra/progress.ts";
import { inputErrorResult, toolResult } from "./infra/result.ts";
import { sessionLifecycle } from "./infra/session-lifecycle.ts";
import type { Params } from "./web-crawl.ts";

export async function crawlRun(params: Params, signal: AbortSignal, onUpdate?: ToolUpdate) {
	const url = await resolveRunUrl(params);
	if (!url) {
		return inputErrorResult(
			"CRAWL_INPUT_MISSING",
			"crawl",
			"web_crawl action=run requires url, or crawlId plus resume=true for a stored crawl.",
			"Provide url, or crawlId with resume=true, to run a crawl.",
		);
	}
	const config = await loadEffectiveConfig();
	const progressView: BatchProgressView = {
		total: Math.max(1, params.maxPages ?? params.limit ?? 1),
		completed: 0,
		succeeded: 0,
		failed: 0,
		concurrency: Math.max(1, params.concurrency ?? 1),
		items: [{ url, status: "queued" }],
		label: "web_crawl",
	};
	const { proxy, ...crawlParams } = params;
	const proxyResolver = Array.isArray(proxy) ? () => resolveProxyParam(proxy) : undefined;
	const crawl = await runCrawl(
		url,
		{
			...config.scrapeDefaults,
			...crawlParams,
			proxy: typeof proxy === "string" ? proxy : undefined,
			resolveProxy: proxyResolver,
			strategy: params.strategy,
			mode: params.mode ?? config.scrapeMode,
			format: config.outputFormat,
			onProgress: (progress) => {
				updateUrlBatchProgress(progressView, progress.state, progress.url);
				if (progress.total) progressView.total = progress.total;
				if (onUpdate) {
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
				}
			},
		},
		{},
		signal,
	);
	const apiSurface = await maybeBuildApiSurface(params, crawl.pages);
	const { metadata: finalStored } = await storeResponseWithId((responseId) => {
		crawl.metadata = { ...crawl.metadata, responseId };
		return apiSurface ? { ...crawl, apiSurface } : crawl;
	});
	crawl.metadata = await updateCrawlMetadata(crawl.crawlId, {
		responseId: finalStored.responseId,
		status: crawl.metadata.status,
	});
	const contextPackage = await compileCrawlContext(params, crawl.crawlId, crawl.pages);
	const responseIds = contextPackage?.responseId
		? [finalStored.responseId, contextPackage.responseId]
		: [finalStored.responseId];
	const manifest = await updateJobManifest(crawl.crawlId, { responseIds });
	const freshness = crawlFreshness(crawl.metadata, config.scrapeDefaults.maxAgeSeconds);
	const surfaceText = apiSurface ? ` apiSurface: ${apiSurface.modules.length} module(s).` : "";
	const packageText = contextPackage
		? ` package: ${contextPackage.value.package.urlCount} page(s), packageResponseId: ${contextPackage.responseId}.`
		: "";
	const strategyLabel = formatCrawlStrategyLabel(crawl.metadata.strategy);
	const strategyText = strategyLabel ? ` strategy=${strategyLabel},` : "";
	const text = `Crawl ${crawl.crawlId}:${strategyText} ${crawl.metadata.succeededCount} succeeded, ${crawl.metadata.failedCount} failed, ${crawl.metadata.visitedCount} visited, frontier ${crawl.metadata.frontierCount}.${surfaceText}${packageText} responseId: ${finalStored.responseId}`;
	const { notice: toolSessionNotice, suffix: sessionSuffix } = await sessionLifecycle(params);
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
			toolSessionNotice: toolSessionNotice ?? undefined,
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
	if (params.extract !== "api-surface") return;
	const { buildApiSurfaceFromScrapes } = await import("../extract/api-surface/index.ts");
	return buildApiSurfaceFromScrapes(pages);
}

async function compileCrawlContext(params: Params, crawlId: string, pages: ScrapeResult[]) {
	if (params.compile !== true) return;
	return await storeCompiledContext({
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
	if (!params.crawlId || params.resume !== true) return;
	try {
		const metadata = await loadCrawlMetadata(params.crawlId);
		return metadata.seedUrl;
	} catch {
		/* ignore */
	}
}

export function crawlFreshness(crawl: CrawlMetadata, maxAgeSeconds?: number): FreshnessMetadata {
	return (
		freshnessFromTimestamp(crawl.updatedAt, maxAgeSeconds) ?? {
			cachedAt: crawl.updatedAt,
			stale: false,
		}
	);
}
