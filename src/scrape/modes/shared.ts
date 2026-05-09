/**
 * @fileoverview scrape modes shared module.
 */
import type { FetchUrlOptions } from "../../http/client.js";
import { structuredErrorFromUnknown } from "../../http/errors.js";
import type {
	CommonScrapeOptions,
	OutputFormat,
	ScrapeMode,
	StructuredError,
} from "../../types.js";
import type { ScrapeResult } from "../pipeline.js";

export function fetchOptions(options: CommonScrapeOptions): FetchUrlOptions {
	return {
		timeoutSeconds: options.timeoutSeconds,
		maxBytes: options.maxBytes,
		headers: options.headers,
		proxy: options.proxy,
		respectRobots: options.respectRobots,
		cacheTtlSeconds: options.cacheTtlSeconds,
		maxAgeSeconds: options.maxAgeSeconds,
		refresh: options.refresh,
		retryAttempts: options.retryAttempts,
		retryBaseDelayMs: options.retryBaseDelayMs,
		retryMaxDelayMs: options.retryMaxDelayMs,
		retryJitterMs: options.retryJitterMs,
		sessionId: options.sessionId,
		cookies: options.cookies,
	};
}

export function resultBase(
	url: string,
	finalUrl: string,
	status: number,
	mode: ScrapeMode,
	format: OutputFormat,
	contentType?: string,
	downloadedBytes?: number,
	cache?: ScrapeResult["cache"],
): ScrapeResult {
	return {
		url,
		finalUrl,
		status,
		mode,
		format,
		timing: { startedAt: new Date().toISOString() },
		truncated: false,
		contentType,
		downloadedBytes,
		cache,
		data: { route: "binary", extractionPath: [mode] },
	};
}

export function scrapeErrorResult(
	url: string,
	mode: ScrapeMode,
	format: OutputFormat,
	error: StructuredError,
): ScrapeResult {
	return {
		url,
		finalUrl: error.finalUrl,
		status: error.statusCode,
		mode,
		format,
		timing: { startedAt: new Date().toISOString() },
		truncated: false,
		error,
		data: { route: "binary", extractionPath: [mode] },
	};
}

export function scrapeStructuredError(
	error: unknown,
	url: string,
): StructuredError {
	return {
		url,
		...structuredErrorFromUnknown(error, {
			code: "SCRAPE_FAILED",
			phase: "scrape",
			message: "Scrape failed",
			url,
		}),
	};
}
