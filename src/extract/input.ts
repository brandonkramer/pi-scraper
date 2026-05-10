/**
 * @fileoverview Shared extraction input preparation.
 */
import { type ScrapePipelineDeps, scrapeUrl } from "../scrape/pipeline.ts";
import type { AdHocExtractOptions, AdHocExtractResult } from "./adhoc/types.ts";
import { MissingExtractInputError } from "./adhoc/types.ts";

export async function prepareExtractionInput(
	options: AdHocExtractOptions,
	deps: ScrapePipelineDeps = {},
	signal?: AbortSignal,
): Promise<{ content: string; input: AdHocExtractResult["input"] }> {
	if (options.content?.trim()) {
		return {
			content: options.content,
			input: { url: options.url, source: "provided" },
		};
	}
	if (!options.url) {
		throw new MissingExtractInputError();
	}
	const scrape = await scrapeUrl(
		options.url,
		{ ...options, format: "markdown" },
		deps,
		signal,
	);
	const content = scrape.data.markdown ?? scrape.data.text ?? "";
	return { content, input: { url: options.url, source: "scrape", scrape } };
}
