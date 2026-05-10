/**
 * @fileoverview Batch expanded result detail formatting.
 */
import type { BatchItem } from "./web-renderer-types.ts";
import { formatResourceFields } from "../tui/resource-fields.ts";

export function batchExpandedDetails(
	items: readonly BatchItem[],
	metadata: { jobId?: unknown; packageResponseId?: unknown } = {},
): string {
	const lines = ["Per-URL details:"];
	for (const item of items.slice(0, 20)) {
		lines.push(...batchItemDetails(item));
	}
	if (items.length > 20) lines.push(`… ${items.length - 20} more URL(s)`);
	const jobId = typeof metadata.jobId === "string" ? metadata.jobId : undefined;
	const packageResponseId =
		typeof metadata.packageResponseId === "string"
			? metadata.packageResponseId
			: undefined;
	if (jobId || packageResponseId) {
		lines.push("", "Stored handles:");
		if (jobId) lines.push(`jobId: ${jobId}`);
		if (packageResponseId)
			lines.push(`packageResponseId: ${packageResponseId}`);
	}
	return lines.join("\n");
}

function batchItemDetails(item: BatchItem): string[] {
	if (!item.ok) {
		const error = item.error;
		return [
			`✕ ${item.url ?? "unknown URL"}`,
			`  ${[error?.code, error?.phase, error?.message ?? "failed"].filter(Boolean).join(" · ")}`,
		];
	}
	const result = item.result;
	const url = item.url ?? result?.url ?? "unknown URL";
	const fields = formatResourceFields({
		status: result?.status,
		mode: result?.mode,
		format: result?.format,
		contentType: result?.contentType,
		downloadedBytes: result?.downloadedBytes,
		durationMs: result?.timing?.durationMs,
		cached: result?.cache?.cached,
		staleness: result?.cache?.staleness,
		truncated: result?.truncated,
	});
	const lines = [`✓ ${url}`, `  ${fields}`];
	if (result?.finalUrl && result.finalUrl !== url)
		lines.push(`  final: ${result.finalUrl}`);
	if (result?.data?.title) lines.push(`  title: ${result.data.title}`);
	const excerpt = resultExcerpt(result);
	if (excerpt) lines.push(`  excerpt: ${excerpt}`);
	return lines;
}

function resultExcerpt(result: BatchItem["result"]): string | undefined {
	const value =
		result?.data?.description ??
		result?.data?.markdown ??
		result?.data?.text ??
		result?.data?.route;
	if (!value) return undefined;
	return String(value).replace(/\s+/g, " ").trim().slice(0, 180);
}
