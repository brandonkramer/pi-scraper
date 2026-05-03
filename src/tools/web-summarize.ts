import { type Static, Type } from "@mariozechner/pi-ai";
import type { ModelAdapter } from "../extract/model.js";
import type { ScrapePipelineDeps } from "../scrape/pipeline.js";
import { summarizePage } from "../summarize/page.js";
import { defineWebTool, type WebTool } from "./define.js";
import { renderEnvelopeResult, renderSimpleCall } from "./render.js";
import {
	errorResult,
	missingModelError,
	structuredToolError,
	toolResult,
} from "./result.js";
import { scrapeOptionSchema, urlProperty } from "./schemas.js";

export const webSummarizeSchema = Type.Object({
	url: Type.Optional(urlProperty("Page URL to scrape before summarization.")),
	content: Type.Optional(
		Type.String({
			description: "Already scraped/provided content to summarize.",
		}),
	),
	sentences: Type.Optional(Type.Number({ minimum: 1, maximum: 20 })),
	bullets: Type.Optional(Type.Number({ minimum: 1, maximum: 20 })),
	...scrapeOptionSchema,
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
		label: "Web Summarize",
		description:
			"Page-scoped summary after scraping. Uses Pi model/LLM execution; use a dedicated research/search extension for multi-source synthesis.",
		parameters: webSummarizeSchema,
		async execute(_toolCallId, params: Params, signal) {
			if (!options.modelAdapter) {
				return errorResult(
					missingModelError("summarize", params.url),
					"web_summarize requires a model-backed adapter; web_scrape can return source text locally.",
				);
			}
			try {
				const result = await summarizePage(
					params,
					options.modelAdapter,
					options.scrapeDeps ?? {},
					signal,
				);
				const scrape = result.input.scrape;
				return toolResult({
					text: result.summary,
					data: result,
					url: result.input.url ?? params.url,
					finalUrl: scrape?.finalUrl,
					status: scrape?.status,
					mode: scrape?.mode,
					format: scrape?.format,
					timing: scrape?.timing,
					truncated: scrape?.truncated,
					contentType: scrape?.contentType,
					downloadedBytes: scrape?.downloadedBytes,
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
