/**
 * @file Fetched-resource field formatter and per-item list composer used by scrape, batch, and
 *   crawl detail renderers.
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
		fields.cached ? `cache hit${fields.staleness ? ` ${fields.staleness}` : ""}` : undefined,
		fields.truncated ? "truncated" : undefined,
	].filter(Boolean);
	return parts.join(" · ") || "fetched";
}

export interface ResourceListItem {
	readonly ok: boolean;
	readonly url: string;
	readonly finalUrl?: string;
	readonly title?: string;
	readonly excerpt?: string;
	readonly fields: FetchedResourceFields;
	readonly error?: { code?: string; phase?: string; message?: string };
}

export function renderResourceItemList(
	items: readonly ResourceListItem[],
	options: {
		header: string;
		maxItems?: number;
		metadata?: { jobId?: unknown; packageResponseId?: unknown };
	},
): string {
	const max = options.maxItems ?? 20;
	const lines = [`\u2514\u2500 ${options.header}`];
	for (const item of items.slice(0, max)) {
		lines.push(...renderResourceItemLines(item));
	}
	if (items.length > max) lines.push(`… ${items.length - max} more item(s)`);
	const jobId = typeof options.metadata?.jobId === "string" ? options.metadata.jobId : undefined;
	const packageResponseId =
		typeof options.metadata?.packageResponseId === "string"
			? options.metadata.packageResponseId
			: undefined;
	if (jobId || packageResponseId) {
		lines.push("", "Stored handles:");
		if (jobId) lines.push(`jobId: ${jobId}`);
		if (packageResponseId) lines.push(`packageResponseId: ${packageResponseId}`);
	}
	return lines.join("\n");
}

function renderResourceItemLines(item: ResourceListItem): string[] {
	if (!item.ok) {
		return [
			`✕ ${item.url || "unknown URL"}`,
			`  ${[item.error?.code, item.error?.phase, item.error?.message ?? "failed"].filter(Boolean).join(" · ")}`,
		];
	}
	const lines = [`✓ ${item.url}`, `  ${formatResourceFields(item.fields)}`];
	if (item.finalUrl && item.finalUrl !== item.url) lines.push(`  final: ${item.finalUrl}`);
	if (item.title) lines.push(`  title: ${item.title}`);
	if (item.excerpt) lines.push(`  excerpt: ${item.excerpt}`);
	return lines;
}
