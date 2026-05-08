/**
 * @fileoverview storage freshness module.
 */
import type { CacheMetadata, FreshnessMetadata } from "../types.js";

export type Staleness = "fresh" | "aging" | "stale" | "expired" | "revalidated";

export interface CacheFreshness extends CacheMetadata {
	staleness?: Staleness;
}

export const DEFAULT_MAX_FRESHNESS_AGE_SECONDS = Number.parseInt(
	process.env.PI_SCRAPER_MAX_CACHE_AGE ?? "604800",
	10,
);

export const STALE_ASSISTANT_GUIDANCE =
	"Content is cached and may be stale. Refresh the source if time-sensitive.";

export function freshnessMetadata(
	fetchedAt: string,
	ttlSeconds: number,
	nowOrOptions: number | { now?: number; maxAgeSeconds?: number } = Date.now(),
	maxAgeSeconds = ttlSeconds,
): CacheFreshness {
	const now =
		typeof nowOrOptions === "number"
			? nowOrOptions
			: (nowOrOptions.now ?? Date.now());
	const freshnessMaxAgeSeconds =
		typeof nowOrOptions === "number"
			? maxAgeSeconds
			: (nowOrOptions.maxAgeSeconds ?? maxAgeSeconds);
	const ageSeconds = ageSince(fetchedAt, now);
	return {
		cached: true,
		cachedAt: fetchedAt,
		fetchedAt,
		ageSeconds,
		ttlSeconds,
		maxAgeSeconds: freshnessMaxAgeSeconds,
		stale: ageSeconds > freshnessMaxAgeSeconds,
		staleness: bucket(ageSeconds, ttlSeconds),
	};
}

export function coldFreshness(): CacheFreshness {
	return { cached: false, stale: false };
}

export function crawlStaleness(updatedAt: string, now = Date.now()) {
	const ageSeconds = ageSince(updatedAt, now);
	const staleness =
		ageSeconds < 86_400
			? "fresh"
			: ageSeconds < 604_800
				? "aging"
				: ageSeconds < 2_592_000
					? "stale"
					: "expired";
	return { ageSeconds, staleness } as const;
}

export function freshnessFromTimestamp(
	cachedAt: string | undefined,
	maxAgeSeconds = DEFAULT_MAX_FRESHNESS_AGE_SECONDS,
	now = Date.now(),
): FreshnessMetadata | undefined {
	if (!cachedAt) return undefined;
	const ageSeconds = ageSince(cachedAt, now);
	return {
		cachedAt,
		ageSeconds,
		maxAgeSeconds,
		stale: ageSeconds > maxAgeSeconds,
	};
}

export function freshnessFromCache(
	cache: CacheMetadata | undefined,
): FreshnessMetadata | undefined {
	if (!cache?.cached) return undefined;
	return {
		cachedAt: cache.cachedAt ?? cache.fetchedAt,
		ageSeconds: cache.ageSeconds,
		maxAgeSeconds: cache.maxAgeSeconds ?? cache.ttlSeconds,
		stale: cache.stale,
	};
}

export function aggregateFreshness(
	items: Array<FreshnessMetadata | undefined>,
): FreshnessMetadata | undefined {
	const present = items.filter(Boolean) as FreshnessMetadata[];
	if (present.length === 0) return undefined;
	const oldest = present.reduce((left, right) =>
		(right.ageSeconds ?? -1) > (left.ageSeconds ?? -1) ? right : left,
	);
	return { ...oldest, stale: present.some((item) => item.stale) };
}

export function guidanceWithFreshness(
	guidance: string | undefined,
	freshness: FreshnessMetadata | undefined,
): string | undefined {
	if (!freshness?.stale) return guidance;
	return guidance
		? `${guidance} ${STALE_ASSISTANT_GUIDANCE}`
		: STALE_ASSISTANT_GUIDANCE;
}

function ageSince(iso: string, now: number): number {
	return Math.max(0, Math.floor((now - Date.parse(iso)) / 1_000));
}

function bucket(ageSeconds: number, ttlSeconds: number): Staleness {
	if (ageSeconds < ttlSeconds * 0.5) return "fresh";
	if (ageSeconds < ttlSeconds) return "aging";
	if (ageSeconds < ttlSeconds * 2) return "stale";
	return "expired";
}
