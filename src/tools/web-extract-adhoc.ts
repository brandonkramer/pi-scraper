/**
 * @fileoverview web_extract action="adhoc" handler — model-backed schema extraction.
 */
import { loadEffectiveConfig } from "../config/settings.ts";
import { extractAdHoc, MissingExtractInputError } from "../extract/adhoc/index.ts";
import { missingModelResult } from "./result.ts";
import {
	scrapeInputSummary,
	scrapeInputToolResult,
} from "./scrape-input-result.ts";
import { toolErrorResult } from "./result.ts";
import type { Params, WebExtractToolOptions } from "./web-extract.ts";

export async function runAdHocExtraction(
	params: Params,
	options: WebExtractToolOptions,
	signal: AbortSignal,
) {
	const config = await loadEffectiveConfig();
	if (!options.modelAdapter) {
		return missingModelResult(
			"extract",
			params.url,
			"web_extract action=adhoc requires a model-backed adapter. Use action=list or action=vertical for deterministic extractors.",
		);
	}
	try {
		const { include, extractSchema, ...extractParams } = params;
		void include;
		void extractSchema;
		const result = await extractAdHoc(
			{
				...config.scrapeDefaults,
				...extractParams,
				mode: params.mode ?? config.scrapeMode,
				format: config.outputFormat,
			},
			options.modelAdapter,
			options.scrapeDeps ?? {},
			signal,
		);
		const summary = scrapeInputSummary(
			"Extracted structured data from",
			result.input,
			" using fresh scrape input",
			" using cached scrape input",
		);
		return scrapeInputToolResult({
			text: summarizeExtraction(result.data),
			data: result,
			input: result.input,
			fallbackUrl: params.url,
			summary,
			answerContext: `${summary} Refresh the source page before extraction when the requested facts are time-sensitive.`,
		});
	} catch (error) {
		return toolErrorResult(
			error,
			error instanceof MissingExtractInputError
				? "MISSING_INPUT"
				: "EXTRACT_FAILED",
			"extract",
			params.url,
		);
	}
}

function summarizeExtraction(data: unknown): string {
	if (typeof data === "string") return data.slice(0, 1200);
	return `Extracted structured data\n${JSON.stringify(data, null, 2).slice(0, 1200)}`;
}
