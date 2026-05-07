import { type Static, Type } from "@mariozechner/pi-ai";
import { loadEffectiveConfig } from "../config/settings.js";
import { extractAdHoc, MissingExtractInputError } from "../extract/ad-hoc.js";
import type { ModelAdapter } from "../extract/model.js";
import type { ScrapePipelineDeps } from "../scrape/pipeline.js";
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

export const webExtractSchema = Type.Object({
	url: Type.Optional(urlProperty()),
	content: Type.Optional(
		Type.String({
			description: "Text input.",
		}),
	),
	prompt: Type.Optional(
		Type.String({ description: "Extraction instructions." }),
	),
	schema: Type.Optional(Type.Unknown({ description: "Output JSON schema." })),
	...scrapeModeOptionSchema,
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
			"Ad hoc LLM JSON/schema extraction from page/content. Use web_vertical_scrape for known-site deterministic data.",
		parameters: webExtractSchema,
		async execute(_toolCallId, params: Params, signal) {
			const config = await loadEffectiveConfig();
			if (!options.modelAdapter) {
				return errorResult(
					missingModelError("extract", params.url),
					"web_extract requires a model-backed adapter; deterministic extractors are available through web_vertical_scrape.",
				);
			}
			try {
				const result = await extractAdHoc(
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
				const summary = `Extracted structured data from ${result.input.source}${scrape?.cache?.cached ? " using cached scrape input" : scrape ? " using fresh scrape input" : " input"}.`;
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
					cache: scrape?.cache,
					summary,
					answerContext: `${summary} Refresh the source page before extraction when the requested facts are time-sensitive.`,
					qualitySignals: qualityFromCache(scrape?.cache),
					assistantGuidance: storedResultGuidance(),
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
