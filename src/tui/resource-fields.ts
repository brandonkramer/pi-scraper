/**
 * @fileoverview Shared formatter for "fetched resource" status/mode/format/bytes/duration/cache lines. Reused by scrape, batch, and crawl detail renderers.
 */
import { formatBytes, formatDuration } from "./format.ts";

export interface FetchedResourceFields {
	status?: number | string;
	mode?: string;
	format?: string;
	contentType?: string;
	downloadedBytes?: number;
	durationMs?: number;
	cached?: boolean;
	staleness?: string;
	truncated?: boolean;
}

export function formatResourceFields(fields: FetchedResourceFields): string {
	const parts = [
		fields.status ? `status ${fields.status}` : undefined,
		fields.mode,
		fields.format,
		fields.contentType,
		formatBytes(fields.downloadedBytes),
		formatDuration(fields.durationMs),
		fields.cached
			? `cache hit${fields.staleness ? ` ${fields.staleness}` : ""}`
			: undefined,
		fields.truncated ? "truncated" : undefined,
	].filter(Boolean);
	return parts.join(" · ") || "fetched";
}
