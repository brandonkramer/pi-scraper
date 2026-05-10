/**
 * @fileoverview scrape pipeline module.
 */
import { DEFAULT_OUTPUT_FORMAT, DEFAULT_SCRAPE_MODE } from "../defaults.ts";
import type { HttpClient } from "../http/client.ts";
import type { FingerprintFetchAdapter } from "../http/fingerprint.ts";
import type { RoutedContentKind } from "../parse/content/route.ts";
import type { ReadableExtraction, extractReadable } from "../parse/page/readable.ts";
import type {
	CommonScrapeOptions,
	OutputFormat,
	ResultEnvelope,
	ScrapeMode,
} from "../types.ts";
import { finishResult, materializeFormat } from "./render.ts";
import type { ScrapeSignals } from "./signals.ts";
import { httpScrape } from "./modes/fast.ts";
import { scrapeErrorResult, scrapeStructuredError } from "./modes/shared.ts";
import type { BrowserRenderer } from "./modes/browser.ts";

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
	try {
		const result = await scrapeByMode(
			input,
			mode,
			format,
			options,
			deps,
			signal,
		);
		return finishResult(materializeFormat(result, format, options), startedAt);
	} catch (error) {
		return finishResult(
			scrapeErrorResult(
				input.toString(),
				mode,
				format,
				scrapeStructuredError(error, input.toString()),
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
		return browserScrape(input, format, options, deps, signal);
	}
	if (mode === "fingerprint") {
		const { fingerprintScrape } = await import("./modes/fingerprint.ts");
		return fingerprintScrape(input, format, options, deps, signal);
	}

	const fast = await httpScrape(input, format, options, deps, signal);
	if (mode === "fast" || fast.data.route !== "html") return fast;
	if (mode === "readable") return readableMode(fast, deps);

	const signals = fast.data.signals;
	if (signals?.shouldTryFingerprint) {
		const fingerprint = await fingerprintMode(
			input,
			format,
			options,
			deps,
			signal,
		);
		if (fingerprint && !fingerprint.data.blocked) return fingerprint;
		if (signals.shouldTryBrowser)
			return browserFallback(
				input,
				format,
				options,
				deps,
				fingerprint ?? fast,
				signal,
			);
		return fingerprint ?? fast;
	}

	const readable = signals?.shouldTryReadable
		? await readableMode(fast, deps)
		: fast;
	const currentTextLength = readable.data.text?.length ?? 0;
	if (
		readable !== fast ||
		(signals?.dataIslandTextLength ?? 0) >= currentTextLength ||
		!signals?.shouldTryBrowser
	) {
		return readable;
	}
	return browserFallback(input, format, options, deps, readable, signal);
}

async function readableMode(
	result: ScrapeResult,
	deps: ScrapePipelineDeps,
): Promise<ScrapeResult> {
	const { withReadable } = await import("./modes/readable.ts");
	return withReadable(result, deps);
}

async function fingerprintMode(
	input: string | URL,
	format: OutputFormat,
	options: CommonScrapeOptions,
	deps: ScrapePipelineDeps,
	signal?: AbortSignal,
): Promise<ScrapeResult | undefined> {
	const { tryFingerprint } = await import("./modes/fingerprint.ts");
	return tryFingerprint(input, format, options, deps, signal);
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
	return tryBrowser(input, format, options, deps, fallback, signal);
}
