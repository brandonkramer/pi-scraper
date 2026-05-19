import { Type } from "typebox";

/** @file Types module. */
import type { ModelUsage } from "./extract/adhoc/model.ts";

export type ScrapeMode = "fast" | "fingerprint" | "readable" | "browser" | "auto";

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

/**
 * Object record used when narrowing unknown JSON-like values.
 *
 * @remarks
 *   This is intentionally broad: callers that need array or prototype exclusion should add those
 *   checks locally after narrowing to object shape.
 */
export type UnknownRecord = Record<string, unknown>;

/**
 * Narrows unknown values to non-null object records.
 *
 * @remarks
 *   Shared by storage and tool adapter boundaries that receive loosely typed host or persisted
 *   data.
 */
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

/** Source note used by agent-facing tools to ground concise synthesis context. */
export interface AgenticSourceNote {
	id: string;
	title?: string;
	uri?: string;
	excerpt?: string;
	relevance?: string;
	retrievedAt?: string;
	sourceType?: string;
}

/** Trust and coverage signals that help downstream assistants avoid overclaiming. */
export interface AgenticQualitySignals {
	confidence?: "high" | "medium" | "low";
	freshness?: "current" | "stale_possible" | "unknown";
	coverage?: "complete" | "partial" | "sampled" | "top_n_only";
	ambiguity?: string[];
	conflicts?: string[];
	partialFailures?: string[];
	knownGaps?: string[];
}

/** Follow-up capability hint for assistants; not a required user-facing question. */
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
	/**
	 * Fetch path note for callers; currently set when scrape follows a same-origin alternate URL or a
	 * meta-refresh redirect.
	 */
	fetchedVia?:
		| {
				kind: "alternate";
				url: string;
				finalUrl?: string;
				type?: string;
				originalUrl?: string;
				originalFinalUrl?: string;
		  }
		| {
				kind: "meta-refresh";
				url: string;
				finalUrl?: string;
				originalUrl?: string;
				originalFinalUrl?: string;
				/** Chain of URLs traversed via meta-refresh redirects. */
				chain?: string[];
		  };
	diagnostics?: Record<string, unknown>;
	error?: StructuredError;
}

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
	return Boolean(
		value &&
		typeof value === "object" &&
		"_progress" in value &&
		(value as ProgressDetails)._progress,
	);
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
	include?: string[];
	exclude?: string[];
	onlyMainContent?: boolean;
	removeImages?: boolean;
	cookies?: Record<string, string>;
	browserProfile?: string;
	osProfile?: string;

	// Session support (Tasks 28 + 30)
	sessionId?: string;
	saveSession?: boolean;
	clearSession?: boolean;

	// Browser rendering options (Tasks 29 + 30)
	waitUntil?: "domcontentloaded" | "load" | "networkidle";
	stealth?: boolean;
	autoWait?: boolean;
	blockResources?: string[];
	blockAds?: boolean;
	hideCanvas?: boolean;
	blockWebRTC?: boolean;
	locale?: string;
	timezone?: string;

	// Raw inspection / line filtering (Task 48)
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

/**
 * Creates a string enum schema compatible with JSON Schema `enum` pattern.
 *
 * @remarks
 *   Inlined from the previous `@earendil-works/pi-ai` re-export so pi-scraper can drop the full
 *   pi-ai dependency tree while keeping the same schema shape.
 */
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
