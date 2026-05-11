/** @file Human-readable scrape result descriptions and time formatting. */
import type { ScrapeResult } from "./pipeline.ts";

const MINUTE_SECONDS = 60;
const HOUR_SECONDS = 60 * MINUTE_SECONDS;
const DAY_SECONDS = 24 * HOUR_SECONDS;

export function formatAge(ageSeconds: number | undefined): string {
	if (ageSeconds === undefined) return "unknown age";
	if (ageSeconds < MINUTE_SECONDS) return `${ageSeconds}s ago`;
	if (ageSeconds < HOUR_SECONDS) return `${Math.floor(ageSeconds / MINUTE_SECONDS)}m ago`;
	if (ageSeconds < DAY_SECONDS) return `${Math.floor(ageSeconds / HOUR_SECONDS)}h ago`;
	return `${Math.floor(ageSeconds / DAY_SECONDS)}d ago`;
}

export function describeScrapeResult(result: ScrapeResult): string {
	const text = result.data.markdown ?? result.data.text ?? result.data.title ?? result.data.route;
	const source = result.cache?.cached
		? `cache hit · ${formatAge(result.cache.ageSeconds)} · ${result.cache.staleness ?? "fresh"}`
		: "fresh fetch";
	// oxlint-disable-next-line typescript/no-unnecessary-condition -- capture group/optional field may be undefined at runtime
	return `${result.status ?? "ok"} · ${result.mode ?? "auto"} · ${result.format ?? "markdown"} · ${source}\n${(text ?? "").slice(0, 1200)}`;
}
