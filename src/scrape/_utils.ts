/**
 * @fileoverview Shared scrape/crawl helpers.
 */
import type { ScrapeResult } from "./pipeline.ts";

export function resultChars(result: ScrapeResult): number {
	return (
		result.data.markdown?.length ??
		result.data.text?.length ??
		result.data.html?.length ??
		0
	);
}
