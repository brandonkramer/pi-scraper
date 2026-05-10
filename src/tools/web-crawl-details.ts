/**
 * @fileoverview Crawl expanded result detail formatting.
 */
import type { CrawlPageView } from "./web-renderer-types.ts";
import { formatResourceFields } from "../tui/resource-fields.ts";

export function crawlExpandedDetails(
	pages: readonly CrawlPageView[],
	metadata: { jobId?: unknown; packageResponseId?: unknown } = {},
): string {
	const lines = ["Per-page details:"];
	for (const page of pages.slice(0, 20)) {
		lines.push(...crawlPageDetails(page));
	}
	if (pages.length > 20) lines.push(`… ${pages.length - 20} more page(s)`);
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

function crawlPageDetails(page: CrawlPageView): string[] {
	if (page.error) {
		return [
			`✕ ${page.finalUrl ?? page.url ?? "unknown URL"}`,
			`  ${[page.error.code, page.error.phase, page.error.message ?? "failed"].filter(Boolean).join(" · ")}`,
		];
	}
	const url = page.finalUrl ?? page.url ?? "unknown URL";
	const fields = formatResourceFields({
		status: page.status,
		mode: page.mode,
		format: page.format,
		contentType: page.contentType,
		downloadedBytes: page.downloadedBytes,
		durationMs: page.timing?.durationMs,
		cached: page.cache?.cached,
		staleness: page.cache?.staleness,
		truncated: page.truncated,
	});
	const lines = [`✓ ${url}`, `  ${fields}`];
	if (page.finalUrl && page.url && page.finalUrl !== page.url)
		lines.push(`  final: ${page.finalUrl}`);
	if (page.data?.title) lines.push(`  title: ${page.data.title}`);
	const excerpt =
		page.data?.description ?? page.data?.markdown ?? page.data?.text;
	if (excerpt)
		lines.push(
			`  excerpt: ${String(excerpt).replace(/\s+/g, " ").trim().slice(0, 180)}`,
		);
	return lines;
}
