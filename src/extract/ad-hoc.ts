import type { ScrapeResult } from "../scrape/pipeline.js";
import { type ScrapePipelineDeps, scrapeUrl } from "../scrape/pipeline.js";
import type { CommonScrapeOptions } from "../types.js";
import type { ModelAdapter } from "./model.js";

export interface AdHocExtractOptions extends CommonScrapeOptions {
	url?: string;
	content?: string;
	prompt?: string;
	schema?: unknown;
}

export interface AdHocExtractResult<T = unknown> {
	input: { url?: string; source: "provided" | "scrape"; scrape?: ScrapeResult };
	data: T;
	raw?: unknown;
}

export class MissingExtractInputError extends Error {
	constructor() {
		super("extractAdHoc requires url or content");
		this.name = "MissingExtractInputError";
	}
}

export async function extractAdHoc<T = unknown>(
	options: AdHocExtractOptions,
	model: ModelAdapter,
	deps: ScrapePipelineDeps = {},
	signal?: AbortSignal,
): Promise<AdHocExtractResult<T>> {
	const prepared = await prepareExtractionInput(options, deps, signal);
	const response = await model.run<T>(
		{
			task: "extract",
			input: prepared.content,
			prompt: options.prompt,
			schema: options.schema,
		},
		signal,
	);
	return { input: prepared.input, data: response.data, raw: response.raw };
}

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
