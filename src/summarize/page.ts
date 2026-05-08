/**
 * @fileoverview summarize page module.
 */
import type { ModelAdapter } from "../extract/model.js";
import type { ScrapeResult } from "../scrape/pipeline.js";
import { type ScrapePipelineDeps, scrapeUrl } from "../scrape/pipeline.js";
import type { CommonScrapeOptions } from "../types.js";

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
		summary: response.text ?? String(response.data ?? ""),
		raw: response.raw,
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
	const scrape = await scrapeUrl(
		options.url,
		{ ...options, format: "markdown" },
		deps,
		signal,
	);
	return {
		content: scrape.data.markdown ?? scrape.data.text ?? "",
		input: { url: options.url, source: "scrape", scrape },
	};
}

function summaryPrompt(options: PageSummaryOptions): string {
	if (options.bullets)
		return `Summarize this page in ${options.bullets} bullets.`;
	return `Summarize this page in ${options.sentences ?? 3} sentences.`;
}
