/**
 * @fileoverview Pi tool adapter for model-backed page summaries.
 */
import { type Static, Type } from "@earendil-works/pi-ai";
import { loadEffectiveConfig } from "../config/settings.ts";
import type { ModelAdapter } from "../extract/adhoc/model.ts";
import type { ScrapePipelineDeps } from "../scrape/pipeline.ts";
import { summarizePage } from "../summarize/page.ts";
import { buildSummarizeToolResult } from "./infra/scrape-input-result.ts";
import { defineWebTool, type WebTool } from "./infra/define.ts";
import { renderEnvelopeResult } from "../tui/envelope.ts";
import { renderSimpleCall } from "../tui/call.ts";
import {
	errorResult,
	missingModelResult,
	missingModelError,
	structuredToolError,
	toolErrorResult,
} from "./infra/result.ts";
import { scrapeModeOptionSchema, urlProperty } from "./infra/schemas.ts";

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
				return buildSummarizeToolResult(result, params.url);
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
		renderResult: (result, { expanded }, theme) =>
			renderEnvelopeResult(result, expanded, theme),
	});
}

export const webSummarizeTool = createWebSummarizeTool();
