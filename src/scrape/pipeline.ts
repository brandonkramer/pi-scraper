/** @file Scrape pipeline module. */
import { DEFAULT_OUTPUT_FORMAT, DEFAULT_SCRAPE_MODE } from "../defaults.ts";
import type { HttpClient } from "../http/client.ts";
import type { FingerprintFetchAdapter } from "../http/fingerprint/index.ts";
import type { RoutedContentKind } from "../parse/content/route.ts";
import { type AlternateLink, discoverAlternateLinks } from "../parse/discovery/alternates.ts";
import { discoverMetaRefresh, type MetaRefresh } from "../parse/discovery/meta-refresh.ts";
import { loadDom } from "../parse/dom/adapter.ts";
import type { ReadableExtraction, extractReadable } from "../parse/page/readable.ts";
import type {
	Chunk,
	CommonScrapeOptions,
	OutputFormat,
	ToolContext,
	ScrapeMode,
} from "../types.ts";
import { normalizeGitHubBlobUrl } from "../url/github-raw.ts";
import { pickAlternateForFormat, shouldFollowAlternate } from "./alternate-match.ts";
import type { LineMatch } from "./line-filter.ts";
import { metaRefreshEnabled, shouldFollowMetaRefresh } from "./meta-refresh.ts";
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
	/** Token-budgeted markdown chunks when `chunks: true`. */
	chunks?: Chunk[];
}

export type ScrapeResult = ToolContext<ScrapeData>;

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
	// Accessibility tree requires a real browser regardless of mode option
	if (format === "ax-tree") {
		const { browserScrape } = await import("./modes/browser.ts");
		return await browserScrape(input, format, options, deps, signal);
	}
	if (mode === "browser") {
		const { browserScrape } = await import("./modes/browser.ts");
		return await browserScrape(input, format, options, deps, signal);
	}
	if (mode === "fingerprint") {
		const { fingerprintScrape } = await import("./modes/fingerprint.ts");
		return await fingerprintScrape(input, format, options, deps, signal);
	}

	const fast = await httpScrape(input, format, options, deps, signal);
	const alternate = await alternateFallback(fast, format, options, deps, signal);
	if (alternate) return alternate;
	const metaRefresh = await metaRefreshFallback(fast, format, options, deps, signal);
	if (metaRefresh) return metaRefresh;
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

async function alternateFallback(
	result: ScrapeResult,
	format: OutputFormat,
	options: CommonScrapeOptions,
	deps: ScrapePipelineDeps,
	signal?: AbortSignal,
): Promise<ScrapeResult | undefined> {
	if (!alternateFallbackEnabled(format, options)) return;
	const currentUrl = result.finalUrl ?? result.url;
	if (!currentUrl || result.data.route !== "html") return;
	const alternates = alternateLinks(result, currentUrl);
	const candidate = pickAlternateForFormat(alternates, format);
	if (!candidate || !shouldFollowAlternate(candidate, result, options)) return;
	const alternate = await scrapeUrl(
		candidate.url,
		{ ...options, alternateFor: currentUrl },
		deps,
		signal,
	);
	if (alternate.error) {
		return {
			...result,
			diagnostics: {
				...result.diagnostics,
				alternateFallback: {
					url: candidate.url,
					type: candidate.type,
					error: alternate.error,
				},
			},
		};
	}
	return mergeAlternateResult(result, alternate, candidate);
}

async function metaRefreshFallback(
	result: ScrapeResult,
	_format: OutputFormat,
	options: CommonScrapeOptions,
	deps: ScrapePipelineDeps,
	signal?: AbortSignal,
): Promise<ScrapeResult | undefined> {
	if (!metaRefreshEnabled(_format, options)) return;
	const currentUrl = result.finalUrl ?? result.url;
	if (!currentUrl || result.data.route !== "html") return;
	const meta = metaRefreshFromResult(result, currentUrl);
	if (!meta || !shouldFollowMetaRefresh(meta, result, options)) return;

	const hopCount = (options.metaRefreshHopCount ?? 0) + 1;
	const chainSoFar = options.metaRefreshChain ?? [];
	const followed = await scrapeUrl(
		meta.url,
		{ ...options, metaRefreshHopCount: hopCount, metaRefreshChain: [...chainSoFar, currentUrl] },
		deps,
		signal,
	);
	if (followed.error) {
		return {
			...result,
			diagnostics: {
				...result.diagnostics,
				metaRefreshFallback: {
					url: meta.url,
					delaySeconds: meta.delaySeconds,
					error: followed.error,
				},
			},
		};
	}
	return mergeMetaRefreshResult(result, followed, meta, hopCount, chainSoFar);
}

function metaRefreshFromResult(result: ScrapeResult, baseUrl: string): MetaRefresh | undefined {
	const fromMeta = result.data.metadata?.metaRefresh;
	if (fromMeta && typeof fromMeta === "object" && "url" in fromMeta) {
		return fromMeta as MetaRefresh;
	}
	// Fallback: parse from stripped HTML (unlikely to find head tags)
	return discoverMetaRefresh(loadDom(result.data.html ?? ""), baseUrl);
}

function mergeMetaRefreshResult(
	original: ScrapeResult,
	followed: ScrapeResult,
	meta: MetaRefresh,
	hopCount: number,
	chainSoFar: string[],
): ScrapeResult {
	const originalUrlStr = original.finalUrl ?? original.url ?? "";
	const innerChain =
		followed.fetchedVia?.kind === "meta-refresh" ? followed.fetchedVia.chain : undefined;
	const chain = innerChain ?? [...chainSoFar, originalUrlStr];
	return {
		...followed,
		url: original.url,
		finalUrl: original.finalUrl,
		fetchedVia: {
			kind: "meta-refresh",
			url: meta.url,
			finalUrl: followed.finalUrl,
			originalUrl: original.url,
			originalFinalUrl: original.finalUrl,
			chain,
		},
		diagnostics: {
			...followed.diagnostics,
			metaRefreshHops: followed.diagnostics?.metaRefreshHops ?? hopCount,
			metaRefreshDelaySeconds: meta.delaySeconds,
		},
	};
}

function alternateFallbackEnabled(format: OutputFormat, options: CommonScrapeOptions): boolean {
	if (options.followAlternates !== undefined) return options.followAlternates;
	return format === "markdown" || format === "json" || format === "text" || format === "llm";
}

function alternateLinks(result: ScrapeResult, currentUrl: string): AlternateLink[] {
	const discovered = discoverAlternateLinks(result.data.html ?? "", currentUrl);
	if (discovered.length > 0) return discovered;
	return metadataAlternateLinks(result.data.metadata?.alternates);
}

function metadataAlternateLinks(value: unknown): AlternateLink[] {
	if (!Array.isArray(value)) return [];
	return value.filter((item) => isAlternateLink(item));
}

function isAlternateLink(value: unknown): value is AlternateLink {
	return Boolean(
		value &&
		typeof value === "object" &&
		"url" in value &&
		typeof value.url === "string" &&
		"rel" in value &&
		typeof value.rel === "string" &&
		"isAgentReadable" in value &&
		typeof value.isAgentReadable === "boolean",
	);
}

function mergeAlternateResult(
	original: ScrapeResult,
	alternate: ScrapeResult,
	candidate: AlternateLink,
): ScrapeResult {
	return {
		...alternate,
		url: original.url,
		finalUrl: original.finalUrl,
		fetchedVia: {
			kind: "alternate",
			url: candidate.url,
			finalUrl: alternate.finalUrl,
			type: candidate.type,
			originalUrl: original.url,
			originalFinalUrl: original.finalUrl,
		},
		diagnostics: { ...alternate.diagnostics, fetchedVia: "alternate" },
	};
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
