/** @file Scrape modes browser module. */
import type { BrowserRenderResult, BrowserRenderer } from "../../browser/playwright.ts";
import { BrowserRenderError, createPlaywrightRenderer } from "../../browser/playwright.ts";
import type { FetchUrlResult } from "../../http/client.ts";
import type { CommonScrapeOptions, OutputFormat } from "../../types.ts";
import type { ScrapePipelineDeps, ScrapeResult } from "../pipeline.ts";
import { responseScrape } from "./fast.ts";
import { resultBase, scrapeErrorResult, scrapeStructuredError } from "./mode-helpers.ts";

export async function browserScrape(
	input: string | URL,
	format: OutputFormat,
	options: CommonScrapeOptions,
	deps: ScrapePipelineDeps,
	signal?: AbortSignal,
): Promise<ScrapeResult> {
	try {
		return await browserResponseScrape(input, format, options, deps, signal);
	} catch (error) {
		return scrapeErrorResult(
			input.toString(),
			"browser",
			format,
			browserStructuredError(error, input.toString()),
		);
	}
}

export async function tryBrowser(
	input: string | URL,
	format: OutputFormat,
	options: CommonScrapeOptions,
	deps: ScrapePipelineDeps,
	fallback: ScrapeResult,
	signal?: AbortSignal,
): Promise<ScrapeResult> {
	try {
		return await browserResponseScrape(input, format, options, deps, signal);
	} catch (error) {
		return {
			...fallback,
			error: browserStructuredError(error, input.toString()),
			data: {
				...fallback.data,
				extractionPath: [...fallback.data.extractionPath, "browser_failed"],
			},
		};
	}
}

async function browserResponseScrape(
	input: string | URL,
	format: OutputFormat,
	options: CommonScrapeOptions,
	deps: ScrapePipelineDeps,
	signal?: AbortSignal,
): Promise<ScrapeResult> {
	const rendered = await (deps.browserRenderer ?? createPlaywrightRenderer()).fetchRendered(
		input,
		{ ...options, format },
		signal,
	);
	if (format === "ax-tree") {
		return axTreeResult(rendered, options);
	}
	const response: FetchUrlResult = {
		url: rendered.url,
		finalUrl: rendered.finalUrl,
		status: rendered.status ?? 200,
		headers: { "content-type": "text/html" },
		contentType: "text/html",
		text: rendered.html,
		downloadedBytes: Buffer.byteLength(rendered.html),
	};
	return await responseScrape(response, "browser", format, options, signal);
}

function axTreeResult(rendered: BrowserRenderResult, _options: CommonScrapeOptions): ScrapeResult {
	const snapshot =
		typeof rendered.axTree === "string" ? rendered.axTree : JSON.stringify(rendered.axTree ?? {});
	const base = resultBase(
		rendered.url,
		rendered.finalUrl,
		rendered.status ?? 200,
		"browser",
		"ax-tree",
		"text/vnd.yaml",
		Buffer.byteLength(snapshot),
	);
	return {
		...base,
		data: {
			route: "html",
			extractionPath: ["browser"],
			text: snapshot,
		},
	};
}

function browserStructuredError(error: unknown, url: string) {
	if (error instanceof BrowserRenderError) return { url, ...error.structured };
	return scrapeStructuredError(error, url);
}

export type { BrowserRenderer };
