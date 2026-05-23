import { Type } from "typebox";

/** @file Types module. */
import type { ModelUsage } from "./extract/adhoc/model.ts";

export type ScrapeMode = "fast" | "fingerprint" | "readable" | "browser" | "auto";
export type BrowserBackend = "cloak" | "playwright";
export const BROWSER_BACKEND_OPTIONS: readonly BrowserBackend[] = ["cloak", "playwright"];

export type OutputFormat = "markdown" | "text" | "llm" | "html" | "json" | "raw";

export type ProgressState =
	| "queued"
	| "connecting"
	| "waiting"
	| "loading"
	| "processing"
	| "done"
	| "error";

export type ToolRequirement = "local" | "browser" | "cloud" | "llm";

/** JSON-like object record. Intentionally broad; narrow further at callsites. */
export type UnknownRecord = Record<string, unknown>;

/** Narrow unknown to non-null object record. Used at storage/adapter boundaries. */
export function isUnknownRecord(value: unknown): value is UnknownRecord {
	return typeof value === "object" && value !== null;
}

export interface PiTextContent {
	type: "text";
	text: string;
}

export interface PiToolShell<TDetails = unknown> {
	content: PiTextContent[];
	details: TDetails;
	isError?: boolean;
}

export interface TimingInfo {
	startedAt: string;
	endedAt?: string;
	durationMs?: number;
	fetchMs?: number;
	parseMs?: number;
	queueMs?: number;
}

export interface StructuredError {
	code: string;
	phase: string;
	message: string;
	retryable: boolean;
	statusCode?: number;
	statusText?: string;
	downloadedBytes?: number;
	timeoutMs?: number;
	url?: string;
	finalUrl?: string;
	recommendedMode?: string;
	cause?: unknown;
}

export interface SourceReference {
	id?: string;
	title?: string;
	url: string;
	finalUrl?: string;
	provider?: string;
	snippet?: string;
	accessedAt?: string;
}

export interface Citation {
	sourceId?: string;
	url?: string;
	title?: string;
	text?: string;
	startOffset?: number;
	endOffset?: number;
}

export interface Chunk {
	text: string;
	tokenCount: number;
	index: number;
}

export interface ResponseStorageMetadata {
	responseId: string;
	fullOutputPath: string;
	storedAt: string;
	byteLength?: number;
	lineCount?: number;
	contentType?: string;
}

export interface FreshnessMetadata {
	cachedAt?: string;
	maxAgeSeconds?: number;
	stale: boolean;
	ageSeconds?: number;
}

export interface CacheMetadata extends FreshnessMetadata {
	cached: boolean;
	fetchedAt?: string;
	ttlSeconds?: number;
	staleness?: string;
}

/** Agent-facing source note. */
export interface AgenticSourceNote {
	id: string;
	title?: string;
	uri?: string;
	excerpt?: string;
	relevance?: string;
	retrievedAt?: string;
	sourceType?: string;
}

/** Trust/coverage signals. */
export interface AgenticQualitySignals {
	confidence?: "high" | "medium" | "low";
	freshness?: "current" | "stale_possible" | "unknown";
	coverage?: "complete" | "partial" | "sampled" | "top_n_only";
	ambiguity?: string[];
	conflicts?: string[];
	partialFailures?: string[];
	knownGaps?: string[];
}

/** Follow-up capability hint. */
export interface AgenticNextAction {
	action: "retrieve" | "refresh" | "rerun" | "narrow" | "compare" | "inspect" | "export";
	tool?: `web_${string}`;
	params?: Record<string, unknown>;
	description: string;
}

export interface ResultEnvelope<TData = unknown> {
	/** Normalized original request URL after URL policy canonicalization, not the verbatim user input. */
	url?: string;
	/** Final normalized URL after redirects or provider canonicalization, when it differs or is known. */
	finalUrl?: string;
	status?: number;
	mode?: ScrapeMode | string;
	format?: OutputFormat | string;
	timing: TimingInfo;
	truncated: boolean;
	fullOutputPath?: string;
	responseId?: string;
	data: TData;
	contentType?: string;
	/** HTTP response headers from the fetch (always captured, shown in expanded view). */
	headers?: Record<string, string>;
	downloadedBytes?: number;
	cache?: CacheMetadata;
	freshness?: FreshnessMetadata;
	sources?: SourceReference[];
	citations?: Citation[];
	summary?: string;
	answerContext?: string;
	kind?: "scrape" | "diff";
	snapshotSaved?: { name: string; tag?: string; path: string };
	modelUsage?: ModelUsage;
	sourceNotes?: AgenticSourceNote[];
	qualitySignals?: AgenticQualitySignals;
	nextActions?: AgenticNextAction[];
	assistantGuidance?: string;
	/** Fetch path note: set when scrape follows a same-origin alternate or a meta-refresh redirect. */
	fetchedVia?: FetchedViaInfo;
	diagnostics?: Record<string, unknown>;
	error?: StructuredError;
}

interface FetchedViaCommon {
	url: string;
	finalUrl?: string;
	originalUrl?: string;
	originalFinalUrl?: string;
}

export type FetchedViaInfo =
	| (FetchedViaCommon & { kind: "alternate"; type?: string })
	| (FetchedViaCommon & { kind: "meta-refresh"; chain?: string[] });

export interface ProgressChecklistItem {
	id: string;
	label: string;
	state: "done" | "pending" | "failed" | "warning" | "info";
	detail?: string;
}

export interface ProgressCounts {
	succeeded?: number;
	failed?: number;
	cacheHits?: number;
	total?: number;
}

export interface ProgressDetails<TData = unknown> {
	_progress: true;
	state: ProgressState;
	message?: string;
	url?: string;
	current?: number;
	total?: number;
	timing?: Partial<TimingInfo>;
	data?: TData;
	checklist?: ProgressChecklistItem[];
	counts?: ProgressCounts;
}

export function isProgress(value: unknown): value is ProgressDetails {
	return !!value && typeof value === "object" && "_progress" in value && !!value._progress;
}

export interface CommonRequestOptions {
	timeoutSeconds?: number;
	maxBytes?: number;
	maxChars?: number;
	headers?: Record<string, string>;
	proxy?: string;
	respectRobots?: boolean;
	cacheTtlSeconds?: number;
	maxAgeSeconds?: number;
	refresh?: boolean;
	retryAttempts?: number;
	retryBaseDelayMs?: number;
	retryMaxDelayMs?: number;
	retryJitterMs?: number;
}

export interface CommonScrapeOptions extends CommonRequestOptions {
	mode?: ScrapeMode;
	format?: OutputFormat;
	/** Return `chunks[]` alongside full markdown (paragraph-bounded, token-budgeted). */
	chunks?: boolean;
	/** Max tokens per chunk when `chunks` is true (default 500). */
	maxTokens?: number;
	/** Overlap tokens between consecutive chunks (default 50). */
	overlapTokens?: number;
	include?: string[];
	exclude?: string[];
	onlyMainContent?: boolean;
	removeImages?: boolean;
	cookies?: Record<string, string>;
	browserProfile?: string;
	osProfile?: string;

	sessionId?: string;
	saveSession?: boolean;
	clearSession?: boolean;
	browserBackend?: BrowserBackend;
	waitUntil?: "domcontentloaded" | "load" | "networkidle";
	stealth?: boolean;
	autoWait?: boolean;
	blockResources?: string[];
	blockAds?: boolean;
	hideCanvas?: boolean;
	blockWebRTC?: boolean;
	locale?: string;
	timezone?: string;

	linesMatching?: string[];
	contextLines?: number;
	caseSensitive?: boolean;

	/** Disable or enable one-hop same-origin alternate format fallback. */
	followAlternates?: boolean;
	/** Internal recursion marker that identifies the original URL for an alternate fetch. */
	alternateFor?: string;
	/** Prefer a same-origin matching alternate even when the primary HTML is not thin. */
	preferAlternates?: boolean;
	/** Minimum meaningful primary text length before alternate fallback is considered unnecessary. */
	alternateThinContentChars?: number;

	/** Disable or enable `<meta http-equiv="refresh">` redirect following. Default ON. */
	followMetaRefresh?: boolean;
	/** Internal hop-count marker for meta-refresh chains. */
	metaRefreshHopCount?: number;
	/** Internal marker that identifies the original URL for a meta-refresh fetch. */
	metaRefreshFor?: string;
	/** Chain of URLs traversed so far in a meta-refresh redirect sequence. */
	metaRefreshChain?: string[];
	/** Prefer following meta-refresh even when primary HTML is not thin. */
	preferMetaRefresh?: boolean;

	/** Download to content-addressed disk storage instead of returning inline. */
	saveToFile?: boolean | { dir?: string; filename?: string; maxBytes?: number };
	/** Minimum meaningful primary text length before meta-refresh fallback is considered unnecessary. */
	metaRefreshThinContentChars?: number;
}

export interface ExtractorCapability {
	name: string;
	urlPatterns: string[];
	requiresBrowser: boolean;
	requiresLLM: boolean;
	requiresCloud: boolean;
	schema: unknown;
	requirements?: ToolRequirement[];
}

/** JSON Schema string enum builder. Inlined from pi-ai re-export. */
export function StringEnum<T extends string>(
	values: readonly T[],
	options?: { description?: string; default?: string },
) {
	return Type.Unsafe<T>({
		type: "string",
		enum: values,
		...(options?.description && { description: options.description }),
		...(options?.default && { default: options.default }),
	});
}
