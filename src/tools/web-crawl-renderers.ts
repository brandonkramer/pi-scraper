/**
 * @fileoverview Pi web_crawl renderer — top-level result/progress card and per-page expanded details.
 */
import {
	isProgress,
	type PiToolShell,
	type ProgressDetails,
	type ResultEnvelope,
} from "../types.ts";
import type { RenderComponent, RenderTheme } from "../tui/types.ts";
import { renderProgress } from "../tui/progress-card.ts";
import {
	renderBatchProgressCard,
	renderBatchResultCard,
} from "./web-batch-renderers.ts";
import {
	batchProgressFromCrawlPages,
	isBatchProgress,
	isBatchProgressView,
} from "../batch/progress-state.ts";
import {
	activityCountSegment,
	failureCountSegment,
	successCountSegment,
} from "../tui/counts.ts";
import { metadataText, neutralText, separator } from "../tui/theme.ts";
import {
	errorTitle,
	sessionNotice,
	contextPackageResponseId,
} from "../tui/envelope-labels.ts";
import type { CrawlMeta, CrawlPageView } from "./web-renderer-views.ts";
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

export function renderWebCrawlResult(
	result: PiToolShell,
	expanded = false,
	theme?: RenderTheme,
): RenderComponent {
	const details = result.details as
		| Partial<ResultEnvelope<unknown>>
		| ProgressDetails;
	if (isProgress(details)) {
		if (isBatchProgress(details))
			return renderBatchProgressCard(details, expanded, theme);
		return renderProgress("web_crawl", details, theme, {
			allowIcons: true,
		});
	}
	const envelope = details as Partial<
		ResultEnvelope<{ metadata?: CrawlMeta; pages?: unknown[] }>
	>;
	const metadata = envelope.data?.metadata;
	const failed = metadata?.failedCount ?? 0;
	const summary = envelope.error
		? errorTitle("web_crawl", envelope.error, { allowIcons: true })
		: [
				successCountSegment(metadata?.succeededCount ?? 0, "succeeded", theme),
				failureCountSegment(failed, "failed", theme),
				activityCountSegment(
					metadata?.visitedCount ?? 0,
					"visited",
					"◉",
					theme,
				),
				neutralText(`→ frontier ${metadata?.frontierCount ?? 0}`, theme),
				!expanded ? metadataText("(ctrl+o to expand)", theme) : undefined,
			]
				.filter(Boolean)
				.join(separator(theme));
	const pages = Array.isArray(envelope.data?.pages)
		? (envelope.data?.pages as CrawlPageView[])
		: [];
	const progress = isBatchProgressView(envelope.diagnostics?.batchProgress)
		? envelope.diagnostics.batchProgress
		: batchProgressFromCrawlPages(pages);
	return renderBatchResultCard(
		{
			progress,
			summary,
			notice: sessionNotice(envelope),
			preview: crawlExpandedDetails(pages, {
				jobId: envelope.diagnostics?.jobId,
				packageResponseId: contextPackageResponseId(envelope),
			}),
			responseId: envelope.responseId,
		},
		expanded,
		theme,
	);
}
