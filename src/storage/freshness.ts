export type Staleness = "fresh" | "aging" | "stale" | "expired" | "revalidated";

export interface CacheFreshness {
	cached: boolean;
	fetchedAt?: string;
	ageSeconds?: number;
	ttlSeconds?: number;
	staleness?: Staleness;
}

export function freshnessMetadata(
	fetchedAt: string,
	ttlSeconds: number,
	now = Date.now(),
): CacheFreshness {
	const ageSeconds = Math.max(
		0,
		Math.floor((now - Date.parse(fetchedAt)) / 1_000),
	);
	return {
		cached: true,
		fetchedAt,
		ageSeconds,
		ttlSeconds,
		staleness: bucket(ageSeconds, ttlSeconds),
	};
}

export function coldFreshness(): CacheFreshness {
	return { cached: false };
}

export function crawlStaleness(updatedAt: string, now = Date.now()) {
	const ageSeconds = Math.max(
		0,
		Math.floor((now - Date.parse(updatedAt)) / 1_000),
	);
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

function bucket(ageSeconds: number, ttlSeconds: number): Staleness {
	if (ageSeconds < ttlSeconds * 0.5) return "fresh";
	if (ageSeconds < ttlSeconds) return "aging";
	if (ageSeconds < ttlSeconds * 2) return "stale";
	return "expired";
}
