/**
 * @fileoverview Pi tool adapter for model-backed page summaries.
 */
import { type Static, Type } from "@mariozechner/pi-ai";
import { loadEffectiveConfig } from "../config/settings.js";
import type { ModelAdapter } from "../extract/model.js";
import type { ScrapePipelineDeps } from "../scrape/pipeline.js";
import { summarizePage } from "../summarize/page.js";
import { qualityFromCache, storedResultGuidance } from "./agentic-context.js";
import { defineWebTool, type WebTool } from "./define.js";
import { renderEnvelopeResult, renderSimpleCall } from "./render.js";
import {
	errorResult,
	missingModelError,
	structuredToolError,
	toolResult,
} from "./result.js";
import { scrapeModeOptionSchema, urlProperty } from "./schemas.js";

export const webSummarizeSchema = Type.Object({
	url: Type.Optional(urlProperty()),
	content: Type.Optional(Type.String()),
	sentences: Type.Optional(Type.Number({ minimum: 1, maximum: 20 })),
	bullets: Type.Optional(Type.Number({ minimum: 1, maximum: 20 })),
	...scrapeModeOptionSchema,
});

type Params = Static<typeof webSummarizeSchema>;

export interface WebSummarizeToolOptions {
	modelAdapter?: ModelAdapter;
	scrapeDeps?: ScrapePipelineDeps;
}

export function createWebSummarizeTool(
	options: WebSummarizeToolOptions = {},
): WebTool<typeof webSummarizeSchema> {
	return defineWebTool({
		name: "web_summarize",
		label: "Sum",
		description: "Summarize URL no multi-source",
		parameters: webSummarizeSchema,
		async execute(_toolCallId, params: Params, signal) {
			const config = await loadEffectiveConfig();
			if (!options.modelAdapter) {
				return errorResult(
					missingModelError("summarize", params.url),
					"web_summarize requires a model-backed adapter; use web_scrape to read source text locally.",
				);
			}
			try {
				const result = await summarizePage(
					{
						...config.scrapeDefaults,
						...params,
						mode: params.mode ?? config.scrapeMode,
						format: config.outputFormat,
					},
					options.modelAdapter,
					options.scrapeDeps ?? {},
					signal,
				);
				const scrape = result.input.scrape;
				const summary = `Summarized ${result.input.source}${scrape?.cache?.cached ? " from cached scrape input" : scrape ? " from fresh scrape input" : " input"}.`;
				return toolResult({
					text: result.summary,
					data: result,
					url: result.input.url ?? params.url,
					finalUrl: scrape?.finalUrl,
					status: scrape?.status,
					mode: scrape?.mode,
					format: scrape?.format ?? "markdown",
					timing: scrape?.timing,
					truncated: scrape?.truncated,
					contentType: scrape?.contentType,
					downloadedBytes: scrape?.downloadedBytes,
					cache: scrape?.cache,
					summary,
					answerContext: `${summary} Refresh the source page before summarizing time-sensitive facts.`,
					qualitySignals: qualityFromCache(scrape?.cache),
					assistantGuidance: storedResultGuidance(),
				});
			} catch (error) {
				return errorResult(
					structuredToolError(
						error,
						"SUMMARIZE_FAILED",
						"summarize",
						params.url,
					),
				);
			}
		},
		renderCall: (args, theme) =>
			renderSimpleCall(
				"web_summarize",
				[
					args.url ?? "provided content",
					args.bullets
						? `${args.bullets} bullets`
						: `${args.sentences ?? 3} sentences`,
				],
				theme,
			),
		renderResult: (result, { expanded }) =>
			renderEnvelopeResult(result, expanded),
	});
}

export const webSummarizeTool = createWebSummarizeTool();
