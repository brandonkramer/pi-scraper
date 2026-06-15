import { type ScrapePipelineDeps, type ScrapeResult, scrapeUrl } from "../scrape/pipeline.ts";
import {
	resolveExtractSource,
	type ExtractSourceResolution,
} from "../tools/infra/extract-source.ts";
import type { CommonScrapeOptions, PiToolShell, ToolContext } from "../types.ts";
/** @file Summarize page module. */
import type { ModelAdapter, ModelUsage } from "./adhoc/model.ts";

export interface PageSummaryOptions extends CommonScrapeOptions {
	url?: string;
	content?: string;
	responseId?: string;
	sentences?: number;
	bullets?: number;
}

export interface PageSummaryResult {
	input: {
		url?: string;
		source: "provided" | "scrape" | "stored";
		scrape?: ScrapeResult;
		responseId?: string;
	};
	summary: string;
	raw?: unknown;
	usage?: ModelUsage;
	resolution?: ExtractSourceResolution;
}

export async function summarizePage(
	options: PageSummaryOptions,
	model: ModelAdapter,
	deps: ScrapePipelineDeps = {},
	signal?: AbortSignal,
): Promise<PageSummaryResult | PiToolShell<ToolContext<undefined>>> {
	const prepared = await prepareSummaryInput(options, deps, signal);
	if ("details" in prepared) return prepared;
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
		resolution: prepared.resolution,
	};
}

async function prepareSummaryInput(
	options: PageSummaryOptions,
	deps: ScrapePipelineDeps,
	signal?: AbortSignal,
): Promise<
	| {
			content: string;
			input: PageSummaryResult["input"];
			resolution?: ExtractSourceResolution;
	  }
	| PiToolShell<ToolContext<undefined>>
> {
	const resolved = await resolveExtractSource(
		{
			content: options.content,
			url: options.url,
			responseId: options.responseId,
		},
		"summarize",
	);
	if ("details" in resolved) {
		const code = (resolved.details as { error?: { code?: string } }).error?.code;
		if (code === "EXTRACT_INPUT_MISSING")
			throw new Error("summarizePage requires url, content, or responseId");
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
		throw new Error("summarizePage requires url, content, or responseId");
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
