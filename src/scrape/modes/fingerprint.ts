/**
 * @fileoverview scrape modes fingerprint module.
 */
import type { FetchUrlResult } from "../../http/client.js";
import type { FingerprintFetchAdapter } from "../../http/fingerprint.js";
import {
	getFingerprintFetchAdapter,
	isFingerprintFetchError,
} from "../../http/fingerprint.js";
import type { CommonScrapeOptions, OutputFormat } from "../../types.js";
import type { ScrapePipelineDeps, ScrapeResult } from "../pipeline.js";
import { responseScrape } from "./fast.js";
import {
	fetchOptions,
	scrapeErrorResult,
	scrapeStructuredError,
} from "./shared.js";

export async function fingerprintScrape(
	input: string | URL,
	format: OutputFormat,
	options: CommonScrapeOptions,
	deps: ScrapePipelineDeps,
	signal?: AbortSignal,
): Promise<ScrapeResult> {
	try {
		return await fingerprintResponseScrape(
			input,
			format,
			options,
			deps,
			signal,
		);
	} catch (error) {
		return scrapeErrorResult(
			input.toString(),
			"fingerprint",
			format,
			fingerprintStructuredError(error, input.toString()),
		);
	}
}

export async function tryFingerprint(
	input: string | URL,
	format: OutputFormat,
	options: CommonScrapeOptions,
	deps: ScrapePipelineDeps,
	signal?: AbortSignal,
): Promise<ScrapeResult | undefined> {
	try {
		return await fingerprintResponseScrape(
			input,
			format,
			options,
			deps,
			signal,
		);
	} catch {
		return undefined;
	}
}

async function fingerprintResponseScrape(
	input: string | URL,
	format: OutputFormat,
	options: CommonScrapeOptions,
	deps: ScrapePipelineDeps,
	signal?: AbortSignal,
): Promise<ScrapeResult> {
	return responseScrape(
		await fingerprintFetch(input, options, deps, signal),
		"fingerprint",
		format,
		options,
		signal,
	);
}

async function fingerprintFetch(
	input: string | URL,
	options: CommonScrapeOptions,
	deps: { fingerprintAdapter?: FingerprintFetchAdapter },
	signal?: AbortSignal,
): Promise<FetchUrlResult> {
	const adapter =
		deps.fingerprintAdapter ??
		getFingerprintFetchAdapter({
			browserProfile: options.browserProfile,
			osProfile: options.osProfile,
			proxy: options.proxy,
		});
	return adapter.fetch(
		input,
		{
			...fetchOptions(options),
			browserProfile: options.browserProfile,
			osProfile: options.osProfile,
			proxy: options.proxy,
		},
		signal,
	);
}

function fingerprintStructuredError(error: unknown, url: string) {
	if (isFingerprintFetchError(error)) return { url, ...error.structured };
	return scrapeStructuredError(error, url);
}
