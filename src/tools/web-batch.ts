/**
 * @fileoverview Pi tool adapter for independent multi-URL scraping.
 */
import { Type, type Static } from "@earendil-works/pi-ai";
import { runBatchScrape, type BatchItemResult } from "../batch/run.js";
import { loadEffectiveConfig } from "../config/settings.js";
import { DEFAULT_CONCURRENCY } from "../defaults.js";
import {
	buildSessionNotice,
	buildSessionText,
	deleteSessionAndStorage,
	saveSessionToStorage,
} from "../http/session.js";
import {
	aggregateFreshness,
	freshnessFromCache,
} from "../storage/freshness.js";
import { updateJobManifest } from "../storage/jobs.js";
import {
	retrieveResultAction,
	storedResultGuidance,
} from "./agentic-context.js";
import { buildStoredContextPackage } from "./context-package.js";
import { defineWebTool } from "./define.js";
import { emitProgress } from "./progress.js";
import {
	cloneBatchProgress,
	type BatchProgressView,
	updateIndexedBatchProgress,
} from "./web-batch-progress-renderer.js";
import { renderWebBatchResult, renderWebToolCall } from "./web-renderers.js";
import { toolResult } from "./result.js";
import { scrapeOutputOptionSchema, urlProperty } from "./schemas.js";

export const webBatchSchema = Type.Object({
	urls: Type.Array(urlProperty(), { minItems: 1 }),
	concurrency: Type.Optional(Type.Number({ minimum: 1, maximum: 32 })),
	perHostConcurrency: Type.Optional(Type.Number({ minimum: 1, maximum: 16 })),
	...scrapeOutputOptionSchema,
	compile: Type.Optional(Type.Any()),
});

async function buildBatchContextPackage(
	params: Params,
	items: readonly BatchItemResult[],
	jobId: string,
) {
	if (params.compile !== true) return undefined;
	const contextPackage = await buildStoredContextPackage({
		source: "batch",
		batchId: jobId,
		pages: items
			.filter((item) => item.ok)
			.map((item) => ({
				url: item.result.finalUrl ?? item.result.url ?? item.url,
				result: item.result,
			})),
	});
	await updateJobManifest(jobId, {
		responseIds: [contextPackage.responseId],
	});
	return contextPackage;
}

type Params = Static<typeof webBatchSchema>;

export const webBatchTool = defineWebTool({
	name: "web_batch",
	label: "Batch",
	description: "per-URL",
	parameters: webBatchSchema,
	async execute(_toolCallId, params: Params, signal, onUpdate) {
		const config = await loadEffectiveConfig();
		const concurrency = Math.max(
			1,
			Math.min(
				params.concurrency ?? DEFAULT_CONCURRENCY.global,
				params.urls.length,
			),
		);
		const batchProgress: BatchProgressView = {
			total: params.urls.length,
			completed: 0,
			succeeded: 0,
			failed: 0,
			concurrency,
			items: params.urls.map((url) => ({ url, status: "queued" })),
		};
		const result = await runBatchScrape(
			params.urls,
			{
				...config.scrapeDefaults,
				...params,
				mode: params.mode ?? config.scrapeMode,
				format: params.format ?? config.outputFormat,
				storeFullResults: true,
				onProgress: (progress) => {
					updateIndexedBatchProgress(
						batchProgress,
						progress.state,
						progress.current,
						progress.url,
					);
					void emitProgress(onUpdate, {
						...progress,
						data: { batchProgress: cloneBatchProgress(batchProgress) },
					});
				},
			},
			{},
			signal,
		);
		const succeeded = result.items.filter((item) => item.ok).length;
		const failed = result.items.length - succeeded;
		const cacheHits = result.items.filter(
			(item) => item.ok && item.result.cache?.cached,
		).length;
		const freshness = aggregateFreshness(
			result.items.map((item) =>
				item.ok
					? (item.result.freshness ?? freshnessFromCache(item.result.cache))
					: undefined,
			),
		);
		const contextPackage = await buildBatchContextPackage(
			params,
			result.items,
			result.jobId,
		);
		const text = contextPackage
			? `${result.summary} Context package: ${contextPackage.value.package.urlCount} page(s), packageResponseId: ${contextPackage.responseId}.`
			: result.summary;
		if (params.sessionId) {
			if (params.saveSession) await saveSessionToStorage(params.sessionId);
			if (params.clearSession) await deleteSessionAndStorage(params.sessionId);
		}
		const sessionNotice = buildSessionNotice(params);
		const sessionSuffix = buildSessionText(params);
		const completedProgress = cloneBatchProgress(batchProgress);
		return toolResult({
			text: text + sessionSuffix,
			data: result.items,
			responseId: result.responseId,
			fullOutputPath: result.fullOutputPath,
			truncated: result.truncated,
			freshness,
			diagnostics: {
				sessionNotice: sessionNotice || undefined,
				batchProgress: completedProgress,
				jobId: result.jobId,
				jobManifestPath: result.jobManifestPath,
				contextPackage: contextPackage && {
					responseId: contextPackage.responseId,
					fullOutputPath: contextPackage.fullOutputPath,
					package: contextPackage.value.package,
				},
			},
			mode: params.mode ?? "auto",
			format: params.format ?? "markdown",
			summary: `${succeeded} succeeded, ${failed} failed, ${cacheHits} cache hit(s) across ${result.items.length} URL(s).`,
			answerContext: `Batch scrape completed with ${succeeded} succeeded and ${failed} failed out of ${result.items.length}. ${cacheHits} successful item(s) came from cache. Use responseId for full per-URL details or jobId ${result.jobId} for the structured job manifest.`,
			qualitySignals: {
				confidence: failed || freshness?.stale ? "medium" : "high",
				freshness: freshness?.stale ? "stale_possible" : "current",
				coverage: failed ? "partial" : "complete",
				partialFailures: failed ? [`${failed} URL(s) failed.`] : undefined,
			},
			nextActions: [
				result.responseId
					? retrieveResultAction(
							result.responseId,
							"Retrieve the full batch result with every per-URL item.",
						)
					: undefined,
				contextPackage
					? retrieveResultAction(
							contextPackage.responseId,
							"Retrieve the compiled context package.",
						)
					: undefined,
			].filter(Boolean) as NonNullable<
				ReturnType<typeof retrieveResultAction>
			>[],
			assistantGuidance: storedResultGuidance(),
		});
	},
	renderCall: (args, theme, context) =>
		renderWebToolCall(
			"web_batch",
			[`${args.urls.length} urls`, `(${args.mode ?? "auto"})`],
			theme,
			context,
			{ donePrefix: false },
		),
	renderResult: (result, { expanded }, theme) =>
		renderWebBatchResult(result, expanded, theme),
});
