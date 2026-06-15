/** @file Shared extraction input preparation. */
import { type ScrapePipelineDeps, scrapeUrl } from "../scrape/pipeline.ts";
import {
	resolveExtractSource,
	type ExtractSourceResolution,
} from "../tools/infra/extract-source.ts";
import type { PiToolShell, ToolContext } from "../types.ts";
import type { AdHocExtractOptions, AdHocExtractResult } from "./adhoc/types.ts";
import { MissingExtractInputError } from "./adhoc/types.ts";

export async function prepareExtractionInput(
	options: AdHocExtractOptions,
	deps: ScrapePipelineDeps = {},
	signal?: AbortSignal,
): Promise<
	| { content: string; input: AdHocExtractResult["input"]; resolution?: ExtractSourceResolution }
	| PiToolShell<ToolContext<undefined>>
> {
	const resolved = await resolveExtractSource(
		{
			content: options.content,
			url: options.url,
			responseId: options.responseId,
		},
		"extract",
	);
	if ("details" in resolved) {
		const code = (resolved.details as { error?: { code?: string } }).error?.code;
		if (code === "EXTRACT_INPUT_MISSING") throw new MissingExtractInputError();
		return resolved;
	}

	if (resolved.primary === "content" || resolved.primary === "responseId") {
		return {
			content: resolved.content,
			input: {
				url: resolved.url ?? options.url,
				source: resolved.primary === "responseId" ? "stored" : "provided",
				scrape: resolved.scrape,
				responseId: resolved.responseId,
			},
			resolution: resolved,
		};
	}

	if (!options.url) {
		throw new MissingExtractInputError();
	}
	const scrape = await scrapeUrl(options.url, { ...options, format: "markdown" }, deps, signal);
	const content = scrape.data.markdown ?? scrape.data.text ?? "";
	return { content, input: { url: options.url, source: "scrape", scrape } };
}
