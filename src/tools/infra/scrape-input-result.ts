/**
 * @fileoverview Shared result shaping for model-backed scrape-input tools.
 */
import type { OutputFormat, ResultEnvelope, TimingInfo } from "../../types.ts";
import { qualityFromCache, storedResultGuidance } from "./agentic-context.ts";
import { toolResult } from "./result.ts";

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

export function buildSummarizeToolResult(
	result: { input: ScrapeInputSource; summary: string; raw?: unknown },
	fallbackUrl?: string,
) {
	const summary = scrapeInputSummary(
		"Summarized",
		result.input,
		" from fresh scrape input",
		" from cached scrape input",
	);
	return scrapeInputToolResult({
		text: result.summary,
		data: result,
		input: result.input,
		fallbackUrl,
		summary,
		answerContext: `${summary} Refresh the source page before summarizing time-sensitive facts.`,
		formatFallback: "markdown",
	});
}
