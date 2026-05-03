import { type Static, Type } from "@mariozechner/pi-ai";
import { extractAdHoc, MissingExtractInputError } from "../extract/ad-hoc.js";
import type { ModelAdapter } from "../extract/model.js";
import type { ScrapePipelineDeps } from "../scrape/pipeline.js";
import { defineWebTool, type WebTool } from "./define.js";
import { renderEnvelopeResult, renderSimpleCall } from "./render.js";
import {
	errorResult,
	missingModelError,
	structuredToolError,
	toolResult,
} from "./result.js";
import { scrapeOptionSchema, urlProperty } from "./schemas.js";

export const webExtractSchema = Type.Object({
	url: Type.Optional(urlProperty("Page URL to scrape before extraction.")),
	content: Type.Optional(
		Type.String({
			description: "Already scraped/provided content to extract from.",
		}),
	),
	prompt: Type.Optional(
		Type.String({ description: "Natural-language extraction instructions." }),
	),
	schema: Type.Optional(
		Type.Unknown({ description: "Desired JSON schema for extraction." }),
	),
	...scrapeOptionSchema,
});

type Params = Static<typeof webExtractSchema>;

export interface WebExtractToolOptions {
	modelAdapter?: ModelAdapter;
	scrapeDeps?: ScrapePipelineDeps;
}

export function createWebExtractTool(
	options: WebExtractToolOptions = {},
): WebTool<typeof webExtractSchema> {
	return defineWebTool({
		name: "web_extract",
		label: "Web Extract",
		description:
			"Ad hoc JSON/schema extraction from one page. Scrapes clean text first, then uses Pi model/LLM execution; use web_vertical_scrape for deterministic known-site extractors.",
		parameters: webExtractSchema,
		async execute(_toolCallId, params: Params, signal) {
			if (!options.modelAdapter) {
				return errorResult(
					missingModelError("extract", params.url),
					"web_extract requires a model-backed adapter; deterministic extractors are available through web_vertical_scrape.",
				);
			}
			try {
				const result = await extractAdHoc(
					params,
					options.modelAdapter,
					options.scrapeDeps ?? {},
					signal,
				);
				const scrape = result.input.scrape;
				return toolResult({
					text: summarizeExtraction(result.data),
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
						error instanceof MissingExtractInputError
							? "MISSING_INPUT"
							: "EXTRACT_FAILED",
						"extract",
						params.url,
					),
				);
			}
		},
		renderCall: (args, theme) =>
			renderSimpleCall("web_extract", [args.url ?? "provided content"], theme),
		renderResult: (result, { expanded }) =>
			renderEnvelopeResult(result, expanded),
	});
}

export const webExtractTool = createWebExtractTool();

function summarizeExtraction(data: unknown): string {
	if (typeof data === "string") return data.slice(0, 1200);
	return `Extracted structured data\n${JSON.stringify(data, null, 2).slice(0, 1200)}`;
}
