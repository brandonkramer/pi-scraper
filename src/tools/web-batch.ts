import { Type, type Static } from "@mariozechner/pi-ai";
import { runBatchScrape } from "../batch/run.js";
import { loadEffectiveConfig } from "../config/settings.js";
import {
	retrieveResultAction,
	storedResultGuidance,
} from "./agentic-context.js";
import { defineWebTool } from "./define.js";
import { emitProgress } from "./progress.js";
import { renderWebBatchResult, renderWebToolCall } from "./web-renderers.js";
import { toolResult } from "./result.js";
import { scrapeOutputOptionSchema, urlProperty } from "./schemas.js";

export const webBatchSchema = Type.Object({
	urls: Type.Array(urlProperty(), { minItems: 1 }),
	concurrency: Type.Optional(Type.Number({ minimum: 1, maximum: 32 })),
	perHostConcurrency: Type.Optional(Type.Number({ minimum: 1, maximum: 16 })),
	...scrapeOutputOptionSchema,
});

type Params = Static<typeof webBatchSchema>;

export const webBatchTool = defineWebTool({
	name: "web_batch",
	label: "Batch",
	description: "Fetch independent URLs per-URL failures",
	parameters: webBatchSchema,
	async execute(_toolCallId, params: Params, signal, onUpdate) {
		const config = await loadEffectiveConfig();
		const result = await runBatchScrape(
			params.urls,
			{
				...config.scrapeDefaults,
				...params,
				mode: params.mode ?? config.scrapeMode,
				format: params.format ?? config.outputFormat,
				storeFullResults: true,
				onProgress: (progress) =>
					void emitProgress(onUpdate, {
						...progress,
						state:
							progress.state === "queued"
								? "queued"
								: progress.state === "processing"
									? "processing"
									: progress.state,
					}),
			},
			{},
			signal,
		);
		const succeeded = result.items.filter((item) => item.ok).length;
		const failed = result.items.length - succeeded;
		const cacheHits = result.items.filter(
			(item) => item.ok && item.result.cache?.cached,
		).length;
		return toolResult({
			text: result.summary,
			data: result.items,
			responseId: result.responseId,
			fullOutputPath: result.fullOutputPath,
			truncated: result.truncated,
			diagnostics: {
				jobId: result.jobId,
				jobManifestPath: result.jobManifestPath,
			},
			mode: params.mode ?? "auto",
			format: params.format ?? "markdown",
			summary: `${succeeded} succeeded, ${failed} failed, ${cacheHits} cache hit(s) across ${result.items.length} URL(s).`,
			answerContext: `Batch scrape completed with ${succeeded} succeeded and ${failed} failed out of ${result.items.length}. ${cacheHits} successful item(s) came from cache. Use responseId for full per-URL details or jobId ${result.jobId} for the structured job manifest.`,
			qualitySignals: {
				confidence: failed ? "medium" : "high",
				freshness: cacheHits ? "stale_possible" : "current",
				coverage: failed ? "partial" : "complete",
				partialFailures: failed ? [`${failed} URL(s) failed.`] : undefined,
			},
			nextActions: result.responseId
				? [
						retrieveResultAction(
							result.responseId,
							"Retrieve the full batch result with every per-URL item.",
						),
					]
				: undefined,
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
	renderResult: (result, { expanded }) =>
		renderWebBatchResult(result, expanded),
});
