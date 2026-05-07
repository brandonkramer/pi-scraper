import type {
	AgenticNextAction,
	AgenticQualitySignals,
	AgenticSourceNote,
	CacheMetadata,
} from "../types.js";

const MINUTE_SECONDS = 60;
const HOUR_SECONDS = 60 * MINUTE_SECONDS;
const DAY_SECONDS = 24 * HOUR_SECONDS;

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

export function narrowSearchAction(
	description = "Rerun with a narrower query or URL scope.",
): AgenticNextAction {
	return { action: "narrow", description };
}

export function sourceNote(options: AgenticSourceNote): AgenticSourceNote {
	return options;
}

export function qualityFromCache(
	cache: CacheMetadata | undefined,
): AgenticQualitySignals {
	if (!cache) return { confidence: "high", freshness: "unknown" };
	return {
		confidence: "high",
		freshness:
			cache.cached &&
			(cache.stale ||
				cache.staleness === "stale" ||
				cache.staleness === "expired")
				? "stale_possible"
				: "current",
		knownGaps: cache.cached
			? [`Cached fetch age: ${formatAge(cache.ageSeconds)}.`]
			: undefined,
	};
}

export function qualityFromStaleness(
	staleness: string | undefined,
	coverage: AgenticQualitySignals["coverage"] = "complete",
): AgenticQualitySignals {
	return {
		confidence:
			staleness === "expired" || staleness === "stale" ? "medium" : "high",
		freshness:
			staleness === "expired" || staleness === "stale"
				? "stale_possible"
				: staleness
					? "current"
					: "unknown",
		coverage,
		knownGaps:
			staleness === "expired" || staleness === "stale"
				? [
						"Stored content may be stale; refresh before answering time-sensitive questions.",
					]
				: undefined,
	};
}

export function ageSecondsSince(iso: string | undefined): number | undefined {
	if (!iso) return undefined;
	const parsed = Date.parse(iso);
	if (Number.isNaN(parsed)) return undefined;
	return Math.max(0, Math.floor((Date.now() - parsed) / 1_000));
}

export function formatAge(ageSeconds: number | undefined): string {
	if (ageSeconds === undefined) return "unknown age";
	if (ageSeconds < MINUTE_SECONDS) return `${ageSeconds}s ago`;
	if (ageSeconds < HOUR_SECONDS)
		return `${Math.floor(ageSeconds / MINUTE_SECONDS)}m ago`;
	if (ageSeconds < DAY_SECONDS)
		return `${Math.floor(ageSeconds / HOUR_SECONDS)}h ago`;
	return `${Math.floor(ageSeconds / DAY_SECONDS)}d ago`;
}

export function truncateInline(value: string | undefined, max = 180): string {
	const text = (value ?? "").replace(/\s+/gu, " ").trim();
	if (text.length <= max) return text;
	return `${text.slice(0, Math.max(0, max - 1))}…`;
}

export function storedResultGuidance(): string {
	return "Use answerContext first. Treat responseId values as local trace handles, not as answers. Refresh before relying on stored data for time-sensitive claims.";
}
