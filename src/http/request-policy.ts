/**
 * @fileoverview Shared robots and politeness policy wrapper for HTTP requests.
 */
import { DEFAULT_RESPECT_ROBOTS } from "../defaults.ts";
import type { PolitenessController } from "./politeness.ts";
import type { RobotsCache } from "./robots.ts";
import type { SafeUrlResult } from "./url-safety.ts";

export interface RequestPolicyOptions<T> {
	safe: SafeUrlResult;
	respectRobots?: boolean;
	applyPolicy?: boolean;
	robots: RobotsCache;
	politeness: PolitenessController;
	userAgent: string;
	signal?: AbortSignal;
	fetch: () => Promise<T>;
}

export async function fetchWithRequestPolicy<T>({
	safe,
	respectRobots,
	applyPolicy = true,
	robots,
	politeness,
	userAgent,
	signal,
	fetch,
}: RequestPolicyOptions<T>): Promise<T> {
	if (!applyPolicy) return await fetch();

	const rules =
		(respectRobots ?? DEFAULT_RESPECT_ROBOTS)
			? await robots.assertAllowed(safe.normalizedUrl, signal)
			: undefined;
	const crawlDelayMs = rules?.crawlDelay(userAgent);
	return await politeness.run(safe.url.host, crawlDelayMs, signal, fetch);
}
