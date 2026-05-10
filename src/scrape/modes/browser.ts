/**
 * @fileoverview scrape modes browser module.
 */
import type { BrowserRenderer } from "../../browser/playwright.ts";
import {
	BrowserRenderError,
	createPlaywrightRenderer,
} from "../../browser/playwright.ts";
import type { FetchUrlResult } from "../../http/client.ts";
import type { CommonScrapeOptions, OutputFormat } from "../../types.ts";
import type { ScrapePipelineDeps, ScrapeResult } from "../pipeline.ts";
import { responseScrape } from "./fast.ts";
import { scrapeErrorResult, scrapeStructuredError } from "./mode-helpers.ts";

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
	const rendered = await (
		deps.browserRenderer ?? createPlaywrightRenderer()
	).fetchRendered(input, options, signal);
	const response: FetchUrlResult = {
		url: rendered.url,
		finalUrl: rendered.finalUrl,
		status: rendered.status ?? 200,
		headers: { "content-type": "text/html" },
		contentType: "text/html",
		text: rendered.html,
		downloadedBytes: Buffer.byteLength(rendered.html),
	};
	return responseScrape(response, "browser", format, options, signal);
}

function browserStructuredError(error: unknown, url: string) {
	if (error instanceof BrowserRenderError) return { url, ...error.structured };
	return scrapeStructuredError(error, url);
}

export type { BrowserRenderer };
