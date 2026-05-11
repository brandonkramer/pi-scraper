/** @file Scrape modes fingerprint module. */
import type { FetchUrlResult } from "../../http/client.ts";
import type { FingerprintFetchAdapter } from "../../http/fingerprint/index.ts";
import {
	getFingerprintFetchAdapter,
	isFingerprintFetchError,
} from "../../http/fingerprint/index.ts";
import type { CommonScrapeOptions, OutputFormat } from "../../types.ts";
import type { ScrapePipelineDeps, ScrapeResult } from "../pipeline.ts";
import { responseScrape } from "./fast.ts";
import { fetchOptions, scrapeErrorResult, scrapeStructuredError } from "./mode-helpers.ts";

export async function fingerprintScrape(
	input: string | URL,
	format: OutputFormat,
	options: CommonScrapeOptions,
	deps: ScrapePipelineDeps,
	signal?: AbortSignal,
): Promise<ScrapeResult> {
	try {
		return await fingerprintResponseScrape(input, format, options, deps, signal);
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
		return await fingerprintResponseScrape(input, format, options, deps, signal);
	} catch {
		/* ignore */
	}
}

async function fingerprintResponseScrape(
	input: string | URL,
	format: OutputFormat,
	options: CommonScrapeOptions,
	deps: ScrapePipelineDeps,
	signal?: AbortSignal,
): Promise<ScrapeResult> {
	return await responseScrape(
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
	return await adapter.fetch(
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
