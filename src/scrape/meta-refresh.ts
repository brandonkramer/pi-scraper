/** @file Meta-refresh redirect heuristic and constants. */

import type { MetaRefresh } from "../parse/discovery/meta-refresh.ts";
import type { CommonScrapeOptions, OutputFormat } from "../types.ts";

export const MAX_META_REFRESH_HOPS = 3;
export const DEFAULT_DELAY_CAP_SECONDS = 5;
export const DEFAULT_THIN_CONTENT_CHARS = 100;

export type MetaRefreshOptions = CommonScrapeOptions;

interface MetaRefreshResultLike {
	url?: string;
	finalUrl?: string;
	data: {
		route?: string;
		markdown?: string;
		text?: string;
		html?: string;
	};
}

/**
 * Decide whether to follow a discovered meta-refresh redirect.
 *
 * Rules:
 *
 * - Delay must be ≤ {@link DEFAULT_DELAY_CAP_SECONDS} (5 seconds by default)
 * - Primary extraction must be thin (< 100 chars of meaningful content) OR user explicitly opts in
 *   via `preferMetaRefresh`
 * - Hop count must be < {@link MAX_META_REFRESH_HOPS} (3)
 * - Target URL must not be identical to the current URL (loop guard)
 * - Must not already be in a meta-refresh chain (prevents recursion)
 */
export function shouldFollowMetaRefresh(
	metaRefresh: MetaRefresh,
	result: MetaRefreshResultLike,
	options: MetaRefreshOptions = {},
): boolean {
	if ((options.metaRefreshHopCount ?? 0) >= MAX_META_REFRESH_HOPS) return false;
	if (metaRefresh.delaySeconds > DEFAULT_DELAY_CAP_SECONDS) return false;
	const currentUrl = result.finalUrl ?? result.url;
	if (!currentUrl) return false;
	if (sameUrl(metaRefresh.url, currentUrl)) return false;
	if (options.preferMetaRefresh) return true;
	if (result.data.route !== "html") return false;
	return (
		meaningfulContentLength(result) <
		(options.metaRefreshThinContentChars ?? DEFAULT_THIN_CONTENT_CHARS)
	);
}

/**
 * Check whether meta-refresh following is enabled for this call. Default ON unless explicitly
 * disabled.
 */
export function metaRefreshEnabled(
	_format: OutputFormat,
	options: MetaRefreshOptions = {},
): boolean {
	if (options.followMetaRefresh !== undefined) return options.followMetaRefresh;
	return true;
}

function sameUrl(candidateUrl: string, currentUrl: string): boolean {
	try {
		const candidate = new URL(candidateUrl);
		const current = new URL(currentUrl);
		candidate.hash = "";
		current.hash = "";
		return candidate.toString() === current.toString();
	} catch {
		return false;
	}
}

function meaningfulContentLength(result: MetaRefreshResultLike): number {
	const content = result.data.markdown ?? result.data.text ?? result.data.html ?? "";
	return content.replaceAll(/\s+/gu, " ").trim().length;
}
