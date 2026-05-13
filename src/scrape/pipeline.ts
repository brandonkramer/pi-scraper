/** @file Scrape pipeline module. */
import { DEFAULT_OUTPUT_FORMAT, DEFAULT_SCRAPE_MODE } from "../defaults.ts";
import type { HttpClient } from "../http/client.ts";
import type { FingerprintFetchAdapter } from "../http/fingerprint/index.ts";
import type { RoutedContentKind } from "../parse/content/route.ts";
import type { ReadableExtraction, extractReadable } from "../parse/page/readable.ts";
import type { CommonScrapeOptions, OutputFormat, ResultEnvelope, ScrapeMode } from "../types.ts";
import { normalizeGitHubBlobUrl } from "../url/github-raw.ts";
import type { LineMatch } from "./line-filter.ts";
import type { BrowserRenderer } from "./modes/browser.ts";
import { httpScrape } from "./modes/fast.ts";
import { scrapeErrorResult, scrapeStructuredError } from "./modes/mode-helpers.ts";
import { finishResult, materializeFormat } from "./render.ts";
import type { ScrapeSignals } from "./signals.ts";

export interface ScrapeData {
	route: RoutedContentKind;
	extractionPath: Array<ScrapeMode | "browser_failed">;
	title?: string;
	description?: string;
	markdown?: string;
	text?: string;
	html?: string;
	json?: unknown;
	metadata?: Record<string, unknown>;
	links?: unknown[];
	signals?: ScrapeSignals;
	readable?: ReadableExtraction;
	blocked?: boolean;
	file?: unknown;
	pdf?: unknown;
	/** Exact full text for raw format retrieval; never truncated. */
	rawText?: string;
	/** Hex sha256 of the fetched body when format=raw. */
	sha256?: string;
	/** Detected charset from the Content-Type header. */
	charset?: string;
	/** Line-filter matches when linesMatching was provided. */
	matches?: LineMatch[];
}

export type ScrapeResult = ResultEnvelope<ScrapeData>;

export interface ScrapePipelineDeps {
	httpClient?: Pick<HttpClient, "fetchUrl">;
	fingerprintAdapter?: FingerprintFetchAdapter;
	browserRenderer?: BrowserRenderer;
	readableExtractor?: typeof extractReadable;
}

export async function scrapeUrl(
	input: string | URL,
	options: CommonScrapeOptions = {},
	deps: ScrapePipelineDeps = {},
	signal?: AbortSignal,
): Promise<ScrapeResult> {
	const startedAt = new Date();
	const mode = options.mode ?? DEFAULT_SCRAPE_MODE;
	const format = options.format ?? DEFAULT_OUTPUT_FORMAT;
	const githubRaw = typeof input === "string" ? normalizeGitHubBlobUrl(input) : undefined;
	const fetchInput = githubRaw ? githubRaw.rawUrl : input;
	try {
		const result = await scrapeByMode(fetchInput, mode, format, options, deps, signal);
		const merged = githubRaw
			? { ...result, url: githubRaw.originalUrl, finalUrl: result.finalUrl ?? githubRaw.rawUrl }
			: result;
		return finishResult(materializeFormat(merged, format, options), startedAt);
	} catch (error) {
		return finishResult(
			scrapeErrorResult(
				githubRaw ? githubRaw.originalUrl : input.toString(),
				mode,
				format,
				scrapeStructuredError(error, githubRaw ? githubRaw.originalUrl : input.toString()),
			),
			startedAt,
		);
	}
}

async function scrapeByMode(
	input: string | URL,
	mode: ScrapeMode,
	format: OutputFormat,
	options: CommonScrapeOptions,
	deps: ScrapePipelineDeps,
	signal?: AbortSignal,
): Promise<ScrapeResult> {
	if (mode === "browser") {
		const { browserScrape } = await import("./modes/browser.ts");
		return await browserScrape(input, format, options, deps, signal);
	}
	if (mode === "fingerprint") {
		const { fingerprintScrape } = await import("./modes/fingerprint.ts");
		return await fingerprintScrape(input, format, options, deps, signal);
	}

	const fast = await httpScrape(input, format, options, deps, signal);
	if (mode === "fast" || fast.data.route !== "html") return fast;
	if (mode === "readable") return await readableMode(fast, deps);

	const signals = fast.data.signals;
	if (signals?.shouldTryFingerprint) {
		const fingerprint = await fingerprintMode(input, format, options, deps, signal);
		if (fingerprint && !fingerprint.data.blocked) return fingerprint;
		if (signals.shouldTryBrowser)
			return await browserFallback(input, format, options, deps, fingerprint ?? fast, signal);
		return fingerprint ?? fast;
	}

	const readable = signals?.shouldTryReadable ? await readableMode(fast, deps) : fast;
	const currentTextLength = readable.data.text?.length ?? 0;
	if (
		readable !== fast ||
		(signals?.dataIslandTextLength ?? 0) >= currentTextLength ||
		!signals?.shouldTryBrowser
	) {
		return readable;
	}
	return await browserFallback(input, format, options, deps, readable, signal);
}

async function readableMode(result: ScrapeResult, deps: ScrapePipelineDeps): Promise<ScrapeResult> {
	const { withReadable } = await import("./modes/readable.ts");
	return await withReadable(result, deps);
}

async function fingerprintMode(
	input: string | URL,
	format: OutputFormat,
	options: CommonScrapeOptions,
	deps: ScrapePipelineDeps,
	signal?: AbortSignal,
): Promise<ScrapeResult | undefined> {
	const { tryFingerprint } = await import("./modes/fingerprint.ts");
	return await tryFingerprint(input, format, options, deps, signal);
}

async function browserFallback(
	input: string | URL,
	format: OutputFormat,
	options: CommonScrapeOptions,
	deps: ScrapePipelineDeps,
	fallback: ScrapeResult,
	signal?: AbortSignal,
): Promise<ScrapeResult> {
	const { tryBrowser } = await import("./modes/browser.ts");
	return await tryBrowser(input, format, options, deps, fallback, signal);
}
