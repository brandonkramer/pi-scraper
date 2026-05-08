/**
 * @fileoverview Pi tool adapter for model-backed page summaries.
 */
import { type Static, Type } from "@earendil-works/pi-ai";
import { loadEffectiveConfig } from "../config/settings.js";
import type { ModelAdapter } from "../extract/model.js";
import type { ScrapePipelineDeps } from "../scrape/pipeline.js";
import { summarizePage } from "../summarize/page.js";
import {
	scrapeInputSummary,
	scrapeInputToolResult,
} from "./scrape-input-result.js";
import { defineWebTool, type WebTool } from "./define.js";
import { renderEnvelopeResult, renderSimpleCall } from "./render.js";
import {
	errorResult,
	missingModelResult,
	missingModelError,
	structuredToolError,
	toolErrorResult,
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
				return missingModelResult(
					"summarize",
					params.url,
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
				const summary = scrapeInputSummary(
					"Summarized",
					result.input,
					" from fresh scrape input",
					" from cached scrape input",
				);
				return scrapeInputToolResult({
					text: result.summary,
					data: result,
					input: result.input,
					fallbackUrl: params.url,
					summary,
					answerContext: `${summary} Refresh the source page before summarizing time-sensitive facts.`,
					formatFallback: "markdown",
				});
			} catch (error) {
				return toolErrorResult(
					error,
					"SUMMARIZE_FAILED",
					"summarize",
					params.url,
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
