import type { BrowserRenderer } from "../browser/playwright.js";
import {
	BrowserRenderError,
	createPlaywrightRenderer,
} from "../browser/playwright.js";
import { DEFAULT_OUTPUT_FORMAT, DEFAULT_SCRAPE_MODE } from "../defaults.js";
import type {
	FetchUrlOptions,
	FetchUrlResult,
	HttpClient,
} from "../http/client.js";
import { createHttpClient, HttpClientError } from "../http/client.js";
import type { FingerprintFetchAdapter } from "../http/fingerprint.js";
import {
	getFingerprintFetchAdapter,
	UnsupportedFingerprintOptionError,
} from "../http/fingerprint.js";
import { extractFastPage } from "../parse/fast.js";
import {
	binaryAttachmentInfo,
	parseJsonText,
	type RoutedContentKind,
	routeContentType,
} from "../parse/passthrough.js";
import { extractPdfText } from "../parse/pdf.js";
import { extractReadable, type ReadableExtraction } from "../parse/readable.js";
import { normalizeWhitespace } from "../serialize/text.js";
import type {
	CommonScrapeOptions,
	OutputFormat,
	ResultEnvelope,
	ScrapeMode,
	StructuredError,
} from "../types.js";
import { finishResult, materializeFormat, renderFormat } from "./render.js";
import {
	analyzeFastResult,
	combineRecoveredText,
	readableIsBetter,
	type ScrapeSignals,
} from "./signals.js";

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
			errorResult(
				input.toString(),
				mode,
				format,
				structuredError(error, input.toString()),
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
	if (mode === "browser")
		return browserScrape(input, format, options, deps, signal);
	if (mode === "fingerprint")
		return responseScrape(
			await fingerprintFetch(input, options, deps, signal),
			"fingerprint",
			format,
			options,
		);

	const fast = await responseScrape(
		await httpFetch(input, options, deps, signal),
		"fast",
		format,
		options,
	);
	if (mode === "fast" || fast.data.route !== "html") return fast;
	if (mode === "readable") return withReadable(fast, deps);

	const signals = fast.data.signals;
	if (signals?.blockedLikely) {
		const fingerprint = await tryFingerprint(
			input,
			format,
			options,
			deps,
			signal,
		);
		if (fingerprint && !fingerprint.data.blocked) return fingerprint;
		if (signals.shouldTryBrowser)
			return tryBrowser(
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
		? await withReadable(fast, deps)
		: fast;
	const currentTextLength = readable.data.text?.length ?? 0;
	if (
		readable !== fast ||
		(signals?.dataIslandTextLength ?? 0) >= currentTextLength ||
		!signals?.shouldTryBrowser
	) {
		return readable;
	}
	return tryBrowser(input, format, options, deps, readable, signal);
}

async function httpFetch(
	input: string | URL,
	options: CommonScrapeOptions,
	deps: ScrapePipelineDeps,
	signal?: AbortSignal,
): Promise<FetchUrlResult> {
	return (deps.httpClient ?? createHttpClient()).fetchUrl(
		input,
		fetchOptions(options),
		signal,
	);
}

async function fingerprintFetch(
	input: string | URL,
	options: CommonScrapeOptions,
	deps: ScrapePipelineDeps,
	signal?: AbortSignal,
): Promise<FetchUrlResult> {
	const adapter =
		deps.fingerprintAdapter ??
		getFingerprintFetchAdapter({
			browserProfile: options.browserProfile,
			osProfile: options.osProfile,
			proxy: options.proxy,
		});
	return adapter.fetch(
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

function fetchOptions(options: CommonScrapeOptions): FetchUrlOptions {
	return {
		timeoutSeconds: options.timeoutSeconds,
		maxBytes: options.maxBytes,
		headers: options.headers,
		proxy: options.proxy,
		respectRobots: options.respectRobots,
	};
}

async function responseScrape(
	response: FetchUrlResult,
	mode: ScrapeMode,
	format: OutputFormat,
	options: CommonScrapeOptions,
): Promise<ScrapeResult> {
	const route = routeContentType(response.contentType, response.finalUrl);
	const base = resultBase(
		response.url,
		response.finalUrl,
		response.status,
		mode,
		format,
		response.contentType,
		response.downloadedBytes,
	);
	if (route.kind === "binary")
		return {
			...base,
			data: {
				route: "binary",
				extractionPath: [mode],
				file: response.file && binaryAttachmentInfo(response.file),
			},
		};
	if (route.kind === "pdf")
		return {
			...base,
			data: {
				route: "pdf",
				extractionPath: [mode],
				file: response.file,
				pdf: await extractPdfText(response.body ?? new Uint8Array()),
			},
		};
	if (!route.shouldParseHtml)
		return passthroughResult(
			base,
			route.kind,
			response.text ?? "",
			format,
			mode,
		);
	return htmlResult(
		base,
		response.text ?? "",
		response.finalUrl,
		mode,
		options,
	);
}

function passthroughResult(
	base: ScrapeResult,
	route: RoutedContentKind,
	text: string,
	format: OutputFormat,
	mode: ScrapeMode,
): ScrapeResult {
	const normalized = normalizeWhitespace(text);
	const json = route === "json" ? safeParseJson(text) : undefined;
	const rendered = renderFormat(format, {
		text: normalized,
		markdown: route === "markdown" ? normalized : undefined,
		html: text,
		json,
	});
	return {
		...base,
		data: { route, extractionPath: [mode], ...rendered, json },
	};
}

function htmlResult(
	base: ScrapeResult,
	html: string,
	finalUrl: string,
	mode: ScrapeMode,
	options: CommonScrapeOptions,
): ScrapeResult {
	const extraction = extractFastPage(html, finalUrl, options);
	const text = combineRecoveredText(extraction);
	const signals = analyzeFastResult(
		{
			...base,
			text: html,
			contentType: base.contentType,
			downloadedBytes: base.downloadedBytes ?? 0,
			headers: {},
		} as FetchUrlResult,
		extraction,
	);
	const metadata = extraction.metadata as unknown as Record<string, unknown>;
	return {
		...base,
		data: {
			route: "html",
			extractionPath: [mode],
			title: extraction.title,
			description: extraction.description,
			text,
			html: extraction.html,
			metadata,
			links: extraction.links,
			signals,
			blocked: signals.blockedLikely,
		},
	};
}

async function withReadable(
	result: ScrapeResult,
	deps: ScrapePipelineDeps,
): Promise<ScrapeResult> {
	const html = result.data.html ?? result.data.markdown ?? "";
	const readable = (deps.readableExtractor ?? extractReadable)(
		html,
		result.finalUrl ?? result.url ?? "",
	);
	if (!readableIsBetter(readable, result.data.text?.length ?? 0))
		return { ...result, data: { ...result.data, readable } };
	const text = readable.textContent ?? result.data.text ?? "";
	return {
		...result,
		mode: "readable",
		data: {
			...result.data,
			extractionPath: [...result.data.extractionPath, "readable"],
			readable,
			title: readable.title ?? result.data.title,
			text,
			html: readable.contentHtml ?? result.data.html,
		},
	};
}

async function browserScrape(
	input: string | URL,
	format: OutputFormat,
	options: CommonScrapeOptions,
	deps: ScrapePipelineDeps,
	signal?: AbortSignal,
): Promise<ScrapeResult> {
	const rendered = await (
		deps.browserRenderer ?? createPlaywrightRenderer()
	).fetchRendered(input, options, signal);
	const response: FetchUrlResult = {
		url: rendered.url,
		finalUrl: rendered.finalUrl,
		status: rendered.status ?? 200,
		headers: { "content-type": "text/html" },
		contentType: "text/html",
		text: rendered.html,
		downloadedBytes: Buffer.byteLength(rendered.html),
	};
	return responseScrape(response, "browser", format, options);
}

async function tryFingerprint(
	input: string | URL,
	format: OutputFormat,
	options: CommonScrapeOptions,
	deps: ScrapePipelineDeps,
	signal?: AbortSignal,
): Promise<ScrapeResult | undefined> {
	try {
		return await responseScrape(
			await fingerprintFetch(input, options, deps, signal),
			"fingerprint",
			format,
			options,
		);
	} catch {
		return undefined;
	}
}

async function tryBrowser(
	input: string | URL,
	format: OutputFormat,
	options: CommonScrapeOptions,
	deps: ScrapePipelineDeps,
	fallback: ScrapeResult,
	signal?: AbortSignal,
): Promise<ScrapeResult> {
	try {
		return await browserScrape(input, format, options, deps, signal);
	} catch (error) {
		return {
			...fallback,
			error: structuredError(error, input.toString()),
			data: {
				...fallback.data,
				extractionPath: [...fallback.data.extractionPath, "browser_failed"],
			},
		};
	}
}

function resultBase(
	url: string,
	finalUrl: string,
	status: number,
	mode: ScrapeMode,
	format: OutputFormat,
	contentType?: string,
	downloadedBytes?: number,
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
		data: { route: "binary", extractionPath: [mode] },
	};
}

function errorResult(
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

function safeParseJson(text: string): unknown {
	try {
		return parseJsonText(text);
	} catch {
		return undefined;
	}
}

function structuredError(error: unknown, url: string): StructuredError {
	if (
		error instanceof BrowserRenderError ||
		error instanceof HttpClientError ||
		error instanceof UnsupportedFingerprintOptionError
	)
		return { url, ...error.structured };
	return {
		code: "SCRAPE_FAILED",
		phase: "scrape",
		message: error instanceof Error ? error.message : "Scrape failed",
		retryable: false,
		url,
		cause: error,
	};
}
