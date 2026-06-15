import { formatAge } from "../../scrape/describe.ts";
/** @file Tools agentic-context module. */
import type {
	AgenticNextAction,
	AgenticQualitySignals,
	AgenticSourceNote,
	CacheMetadata,
} from "../../types.ts";

export function retrieveResultAction(
	responseId: string,
	description = "Use the stored responseId as a local trace handle.",
): AgenticNextAction {
	return {
		action: "retrieve",
		params: { responseId },
		description,
	};
}

export function refreshUrlAction(
	url: string,
	description = "Fetch a fresh copy when current facts matter.",
): AgenticNextAction {
	return {
		action: "refresh",
		tool: "web_scrape",
		params: { url, refresh: true },
		description,
	};
}

export function crawlAction(
	url: string,
	description: string,
	params: Record<string, unknown> = {},
): AgenticNextAction {
	return {
		action: "rerun",
		tool: "web_crawl",
		params: { url, ...params },
		description,
	};
}

export function sourceNote(options: AgenticSourceNote): AgenticSourceNote {
	return options;
}

export function storedTraceContext(options: {
	responseId: string;
	source: AgenticSourceNote;
	retrieveDescription?: string;
	extraActions?: AgenticNextAction[];
	guidanceSuffix?: string;
}): {
	sourceNotes: AgenticSourceNote[];
	nextActions: AgenticNextAction[];
	assistantGuidance: string;
} {
	return {
		sourceNotes: [sourceNote(options.source)],
		nextActions: [
			retrieveResultAction(options.responseId, options.retrieveDescription),
			...(options.extraActions ?? []),
		],
		assistantGuidance: options.guidanceSuffix
			? `${storedResultGuidance()} ${options.guidanceSuffix}`
			: storedResultGuidance(),
	};
}

export function qualityFromCache(cache: CacheMetadata | undefined): AgenticQualitySignals {
	if (!cache) return { confidence: "high", freshness: "unknown" };
	return {
		confidence: "high",
		freshness:
			cache.cached && (cache.stale || cache.staleness === "stale" || cache.staleness === "expired")
				? "stale_possible"
				: "current",
		knownGaps: cache.cached ? [`Cached fetch age: ${formatAge(cache.ageSeconds)}.`] : undefined,
	};
}

export function storedResultGuidance(): string {
	return "Use answerContext first. Treat responseId values as local trace handles, not as answers. Refresh before relying on stored data for time-sensitive claims.";
}

export function browserCaptureGuidance(): string {
	return "Stored browser captures are immutable evidence, not live session state. @eN element refs in captures are snapshot affordances only — they are not durable action handles. This is not a web_scrape diff snapshot.";
}

export function browserLiveCaptureGuidance(): string {
	return "Live-page capture reflects the current DOM after browser interaction without re-navigation. Use web_extract responseId to extract from stored captures without fetching again.";
}

export function browserCookieBridgeGuidance(): string {
	return "Auth carry-over only: exported browser cookies can seed fast/fingerprint HTTP requests for the scoped domain. Cookie values are not shown in output. This does not carry live DOM, scroll position, or element refs.";
}

export function browserStoredCaptureContext(options: {
	responseId: string;
	url: string;
	captureKind: "browser_capture" | "browser_live_capture";
	excerpt: string;
}): {
	sourceNotes: AgenticSourceNote[];
	nextActions: AgenticNextAction[];
	assistantGuidance: string;
	summary: string;
	answerContext: string;
} {
	const isLive = options.captureKind === "browser_live_capture";
	const label = isLive ? "live-page capture" : "browser snapshot capture";
	return {
		summary: `Stored ${label} for ${options.url}.`,
		answerContext: isLive
			? "This evidence came from the live browser DOM after interaction, not from a network re-fetch."
			: "This evidence is an immutable accessibility snapshot from web_browser. Element refs are not durable handles.",
		sourceNotes: [
			sourceNote({
				id: options.responseId,
				title: label,
				uri: options.url,
				excerpt: options.excerpt.slice(0, 240),
				relevance: isLive
					? "Live DOM capture after browser interaction."
					: "Interactive accessibility snapshot for follow-up extraction.",
				retrievedAt: new Date().toISOString(),
				sourceType: "browser",
			}),
		],
		nextActions: [
			retrieveResultAction(options.responseId, "Retrieve the full stored browser capture."),
			{
				action: "inspect",
				tool: "web_extract",
				params: { responseId: options.responseId },
				description: "Extract from the stored capture without re-navigation.",
			},
		],
		assistantGuidance: isLive ? browserLiveCaptureGuidance() : browserCaptureGuidance(),
	};
}
