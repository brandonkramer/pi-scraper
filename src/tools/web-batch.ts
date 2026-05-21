/** @file Pi tool adapter for independent multi-URL scraping. */
import { Type, type Static } from "typebox";

import { compileBatchContext } from "../batch/compile.ts";
import {
	cloneBatchProgress,
	type BatchProgressView,
	updateIndexedBatchProgress,
} from "../batch/progress-state.ts";
import { runBatchScrape } from "../batch/run.ts";
import { loadEffectiveConfig } from "../config.ts";
import { DEFAULT_CONCURRENCY } from "../defaults.ts";
import { filterLines } from "../scrape/line-filter.ts";
import { formatLabeledLineMatchPreview } from "../scrape/line-preview.ts";
import { aggregateFreshness, freshnessFromCache } from "../storage/cache/freshness.ts";
import { renderSimpleCall } from "../tui/call.ts";
import { retrieveResultAction, storedResultGuidance } from "./infra/agentic-context.ts";
import { defineWebTool } from "./infra/define.ts";
import { emitProgress } from "./infra/progress.ts";
import { toolResult } from "./infra/result.ts";
import { scrapeOutputOptionSchema } from "./infra/schemas.ts";
import { sessionLifecycle } from "./infra/session-lifecycle.ts";
import { renderWebBatchResult } from "./renderers/batch.ts";

export const webBatchSchema = Type.Object({
	urls: Type.Array(Type.Unsafe<string>({}), { minItems: 1 }),
	concurrency: Type.Optional(Type.Number()),
	perHostConcurrency: Type.Optional(Type.Number()),
	...scrapeOutputOptionSchema,
	linesMatching: Type.Optional(Type.Array(Type.Unsafe<string>({}))),
	contextLines: Type.Optional(Type.Unsafe<number>({})),
	caseSensitive: Type.Optional(Type.Unsafe<boolean>({})),
	compile: Type.Optional(
		Type.Union([
			Type.Boolean(),
			Type.Object({
				mode: Type.Optional(Type.String()),
			}),
		]),
	),
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
			Math.min(params.concurrency ?? DEFAULT_CONCURRENCY.global, params.urls.length),
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
					updateIndexedBatchProgress(batchProgress, progress.state, progress.current, progress.url);
					void emitProgress(onUpdate, {
						...progress,
						data: { batchProgress: cloneBatchProgress(batchProgress) },
					});
				},
			},
			{},
			signal,
		);
		const needles = params.linesMatching;
		if (needles && needles.length > 0) {
			for (const item of result.items) {
				if (!item.ok) continue;
				const text = item.result.data.rawText ?? item.result.data.text ?? "";
				const matches = filterLines(text, needles, params.contextLines, params.caseSensitive);
				item.result = { ...item.result, data: { ...item.result.data, matches } };
			}
		}
		const succeeded = result.items.filter((item) => item.ok).length;
		const failed = result.items.length - succeeded;
		const cacheHits = result.items.filter((item) => item.ok && item.result.cache?.cached).length;
		const freshness = aggregateFreshness(
			result.items.map((item) =>
				item.ok ? (item.result.freshness ?? freshnessFromCache(item.result.cache)) : undefined,
			),
		);
		const matchPreview = formatLabeledLineMatchPreview(
			result.items
				.filter((item) => item.ok)
				.map((item) => ({
					label: labelFromUrl(item.result.finalUrl ?? item.result.url ?? item.url),
					matches: item.result.data.matches,
				})),
			{ maxChars: 4_000, maxMatches: 5 },
		);
		const contextPackage = await compileBatchContext(params, result.items, result.jobId);
		const contextText = contextPackage
			? ` Context: ${contextPackage.value.package.urlCount} page(s), responseId: ${contextPackage.responseId}.`
			: "";
		const text = `${result.summary}${contextText}${matchPreview ? `\n${matchPreview}` : ""}`;
		const { notice: sessionNotice, suffix: sessionSuffix } = await sessionLifecycle(params);
		const completedProgress = cloneBatchProgress(batchProgress);
		return toolResult({
			text: text + sessionSuffix,
			data: result.items,
			responseId: result.responseId,
			fullOutputPath: result.fullOutputPath,
			truncated: result.truncated,
			freshness,
			diagnostics: {
				sessionNotice: sessionNotice ?? undefined,
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
			answerContext: `Batch scrape completed with ${succeeded} succeeded and ${failed} failed out of ${result.items.length}. ${cacheHits} successful item(s) came from cache.${matchPreview ? `\n${matchPreview}` : ""} Use responseId for full per-URL details or jobId ${result.jobId} for the structured job manifest.`,
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
					? retrieveResultAction(contextPackage.responseId, "Retrieve the compiled context.")
					: undefined,
			].filter(Boolean) as NonNullable<ReturnType<typeof retrieveResultAction>>[],
			assistantGuidance: storedResultGuidance(),
		});
	},
	renderCall: (args, theme, _context) =>
		renderSimpleCall("web_batch", [`${args.urls.length} urls`, `(${args.mode ?? "auto"})`], theme),
	renderResult: (result, { expanded }, theme) => renderWebBatchResult(result, expanded, theme),
});

function labelFromUrl(url: string): string {
	try {
		const parsed = new URL(url);
		return parsed.pathname.split("/").findLast((segment) => segment.length > 0) ?? parsed.hostname;
	} catch {
		return url;
	}
}
