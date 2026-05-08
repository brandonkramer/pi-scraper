/**
 * @fileoverview scrape modes shared module.
 */
import type { FetchUrlOptions } from "../../http/client.js";
import { HttpClientError } from "../../http/client.js";
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

export function errorResult(
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

export function structuredError(error: unknown, url: string): StructuredError {
	if (error instanceof HttpClientError) return { url, ...error.structured };
	return {
		code: "SCRAPE_FAILED",
		phase: "scrape",
		message: error instanceof Error ? error.message : "Scrape failed",
		retryable: false,
		url,
		cause: error,
	};
}
