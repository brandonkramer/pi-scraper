/**
 * @fileoverview Shared scrape/crawl helpers.
 */
import type { ScrapeResult } from "./pipeline.js";

export function resultChars(result: ScrapeResult): number {
	return (
		result.data.markdown?.length ??
		result.data.text?.length ??
		result.data.html?.length ??
		0
	);
}

export function isAbortError(error: unknown, signal?: AbortSignal): boolean {
	return (
		signal?.aborted === true ||
		(error instanceof Error && error.name === "AbortError")
	);
}
