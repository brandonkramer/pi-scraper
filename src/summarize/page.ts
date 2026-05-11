/** @file Summarize page module. */
import type { ModelAdapter, ModelUsage } from "../extract/adhoc/model.ts";
import { type ScrapePipelineDeps, type ScrapeResult, scrapeUrl } from "../scrape/pipeline.ts";
import type { CommonScrapeOptions } from "../types.ts";

export interface PageSummaryOptions extends CommonScrapeOptions {
	url?: string;
	content?: string;
	sentences?: number;
	bullets?: number;
}

export interface PageSummaryResult {
	input: { url?: string; source: "provided" | "scrape"; scrape?: ScrapeResult };
	summary: string;
	raw?: unknown;
	usage?: ModelUsage;
}

export async function summarizePage(
	options: PageSummaryOptions,
	model: ModelAdapter,
	deps: ScrapePipelineDeps = {},
	signal?: AbortSignal,
): Promise<PageSummaryResult> {
	const prepared = await prepareSummaryInput(options, deps, signal);
	const response = await model.run<string>(
		{
			task: "summarize",
			input: prepared.content,
			prompt: summaryPrompt(options),
			options: { sentences: options.sentences, bullets: options.bullets },
		},
		signal,
	);
	return {
		input: prepared.input,
		// oxlint-disable-next-line typescript/no-unnecessary-condition -- capture group/optional field may be undefined at runtime
		summary: response.text ?? response.data ?? "",
		raw: response.raw,
		usage: response.usage,
	};
}

async function prepareSummaryInput(
	options: PageSummaryOptions,
	deps: ScrapePipelineDeps,
	signal?: AbortSignal,
): Promise<{ content: string; input: PageSummaryResult["input"] }> {
	if (options.content?.trim()) {
		return {
			content: options.content,
			input: { url: options.url, source: "provided" },
		};
	}
	if (!options.url) {
		throw new Error("summarizePage requires url or content");
	}
	const scrape = await scrapeUrl(options.url, { ...options, format: "markdown" }, deps, signal);
	return {
		content: scrape.data.markdown ?? scrape.data.text ?? "",
		input: { url: options.url, source: "scrape", scrape },
	};
}

function summaryPrompt(options: PageSummaryOptions): string {
	if (options.bullets) return `Summarize this page in ${options.bullets} bullets.`;
	return `Summarize this page in ${options.sentences ?? 3} sentences.`;
}
