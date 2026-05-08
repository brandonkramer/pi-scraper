/**
 * @fileoverview Shared result shaping for model-backed scrape-input tools.
 */
import type { OutputFormat, ResultEnvelope, TimingInfo } from "../types.js";
import { qualityFromCache, storedResultGuidance } from "./agentic-context.js";
import { toolResult } from "./result.js";

interface ScrapeInputSource {
	source: string;
	url?: string;
	scrape?: ScrapeInputResult;
}

interface ScrapeInputResult {
	finalUrl?: string;
	status?: number;
	mode?: string;
	format?: OutputFormat | string;
	timing?: Partial<TimingInfo>;
	truncated?: boolean;
	contentType?: string;
	downloadedBytes?: number;
	cache?: ResultEnvelope<unknown>["cache"];
}

export interface ScrapeInputToolResultOptions<TData> {
	text: string;
	data: TData;
	input: ScrapeInputSource;
	fallbackUrl?: string;
	summary: string;
	answerContext: string;
	formatFallback?: OutputFormat | string;
}

export function scrapeInputToolResult<TData>({
	text,
	data,
	input,
	fallbackUrl,
	summary,
	answerContext,
	formatFallback,
}: ScrapeInputToolResultOptions<TData>) {
	const scrape = input.scrape;
	return toolResult({
		text,
		data,
		url: input.url ?? fallbackUrl,
		finalUrl: scrape?.finalUrl,
		status: scrape?.status,
		mode: scrape?.mode,
		format: scrape?.format ?? formatFallback,
		timing: scrape?.timing,
		truncated: scrape?.truncated,
		contentType: scrape?.contentType,
		downloadedBytes: scrape?.downloadedBytes,
		cache: scrape?.cache,
		summary,
		answerContext,
		qualitySignals: qualityFromCache(scrape?.cache),
		assistantGuidance: storedResultGuidance(),
	});
}

export function scrapeInputSummary(
	verb: string,
	input: ScrapeInputSource,
	freshPhrase: string,
	cachedPhrase: string,
): string {
	const scrape = input.scrape;
	return `${verb} ${input.source}${scrape?.cache?.cached ? cachedPhrase : scrape ? freshPhrase : " input"}.`;
}
