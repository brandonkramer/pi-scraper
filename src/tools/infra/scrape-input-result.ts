import type { ModelUsage } from "../../extract/adhoc/model.ts";
/** @file Shared result shaping for model-backed scrape-input tools. */
import type { AgenticSourceNote, OutputFormat, ToolContext, TimingInfo } from "../../types.ts";
import { qualityFromCache, storedResultGuidance } from "./agentic-context.ts";
import { toolResult } from "./result.ts";

interface ScrapeInputSource {
	source: "provided" | "scrape" | "stored";
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
	cache?: ToolContext<unknown>["cache"];
}

export interface ScrapeInputToolContextOptions<TData> {
	text: string;
	data: TData;
	input: ScrapeInputSource;
	fallbackUrl?: string;
	summary: string;
	answerContext: string;
	formatFallback?: OutputFormat | string;
	modelUsage?: ModelUsage;
	sourceNotes?: AgenticSourceNote[];
}

export function scrapeInputToolContext<TData>({
	text,
	data,
	input,
	fallbackUrl,
	summary,
	answerContext,
	formatFallback,
	modelUsage,
	sourceNotes,
}: ScrapeInputToolContextOptions<TData>) {
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
		modelUsage,
		sourceNotes,
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
	if (input.source === "stored")
		return `${verb} stored evidence${scrape?.cache?.cached ? cachedPhrase : ""}.`;
	return `${verb} ${input.source}${scrape?.cache?.cached ? cachedPhrase : scrape ? freshPhrase : " input"}.`;
}

export function buildSummarizeToolContext(
	result: {
		input: ScrapeInputSource;
		summary: string;
		raw?: unknown;
		usage?: ModelUsage;
	},
	fallbackUrl?: string,
) {
	const summary = scrapeInputSummary(
		"Summarized",
		result.input,
		" from fresh scrape input",
		" from cached scrape input",
	);
	return scrapeInputToolContext({
		text: result.summary,
		data: result,
		input: result.input,
		fallbackUrl,
		summary,
		answerContext: "Refresh the source page before summarizing time-sensitive facts.",
		formatFallback: "markdown",
		modelUsage: result.usage,
	});
}
