/**
 * @fileoverview Pi tool adapter for independent multi-URL scraping.
 */
import { Type, type Static } from "@earendil-works/pi-ai";
import { runBatchScrape } from "../batch/run.ts";
import { loadEffectiveConfig } from "../config/settings.ts";
import { DEFAULT_CONCURRENCY } from "../defaults.ts";
import { sessionLifecycle } from "./session-lifecycle.ts";
import {
	aggregateFreshness,
	freshnessFromCache,
} from "../storage/freshness.ts";
import {
	retrieveResultAction,
	storedResultGuidance,
} from "./agentic-context.ts";
import { buildBatchContextPackage } from "../batch/compile.ts";
import { defineWebTool } from "./define.ts";
import { emitProgress } from "./progress.ts";
import {
	cloneBatchProgress,
	type BatchProgressView,
	updateIndexedBatchProgress,
} from "../batch/progress-state.ts";
import { renderWebBatchResult } from "./web-batch-renderers.ts";
import { renderSimpleCall } from "../tui/simple-call.ts";
import { toolResult } from "./result.ts";
import { scrapeOutputOptionSchema, urlProperty } from "./schemas.ts";

export const webBatchSchema = Type.Object({
	urls: Type.Array(urlProperty(), { minItems: 1 }),
	concurrency: Type.Optional(Type.Number({ minimum: 1, maximum: 32 })),
	perHostConcurrency: Type.Optional(Type.Number({ minimum: 1, maximum: 16 })),
	...scrapeOutputOptionSchema,
	compile: Type.Optional(Type.Any()),
});

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
		const { notice: sessionNotice, suffix: sessionSuffix } =
			await sessionLifecycle(params);
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
	renderCall: (args, theme, _context) =>
		renderSimpleCall(
			"web_batch",
			[`${args.urls.length} urls`, `(${args.mode ?? "auto"})`],
			theme,
		),
	renderResult: (result, { expanded }, theme) =>
		renderWebBatchResult(result, expanded, theme),
});
