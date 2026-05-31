import {
	batchProgressFromCrawlPages,
	isBatchProgress,
	isBatchProgressView,
} from "../../batch/progress-state.ts";
import { formatCrawlStrategyLabel } from "../../crawl/state.ts";
/** @file Pi web_crawl renderer — top-level result/progress card and per-page expanded details. */
import {
	isProgress,
	type PiToolShell,
	type ProgressDetails,
	type ToolContext,
} from "../../types.ts";
import {
	toolBatchProgressCard,
	toolBatchResultCard,
	toolProgressCard,
	toolResultCard,
} from "../tool-card.ts";
import {
	toolActivityCount,
	toolPickExcerpt,
	toolResourceList,
	type ToolResourceListItem,
} from "../tool-format.ts";
import { toolContextPackageResponseId, toolErrorLabel, toolSessionNotice } from "../tool-labels.ts";
import { toolResultTree } from "../tool-result-tree.ts";
import { buildExpandedResultDetails, toolResultId } from "../tool-result.ts";
import { toolStatusMark, toolStatus } from "../tool-status.ts";
import { toolNeutral } from "../tool-text.ts";
import type { RenderComponent, RenderTheme } from "../types.ts";
export interface CrawlMeta {
	succeededCount: number;
	failedCount: number;
	visitedCount: number;
	frontierCount: number;
	strategy?: string;
}

export interface CrawlPageView {
	ok?: boolean;
	url?: string;
	finalUrl?: string;
	status?: number;
	mode?: string;
	format?: string;
	contentType?: string;
	downloadedBytes?: number;
	truncated?: boolean;
	timing?: { durationMs?: number };
	cache?: { cached?: boolean; staleness?: string };
	data?: {
		title?: string;
		description?: string;
		markdown?: string;
		text?: string;
	};
	error?: { code?: string; phase?: string; message?: string };
}

export function crawlExpandedDetails(
	pages: readonly CrawlPageView[],
	metadata: { jobId?: unknown; packageResponseId?: unknown } = {},
): string {
	const cap = Math.max(100, Math.min(500, Math.floor(1000 / Math.max(1, pages.length))));
	return toolResourceList(
		pages.map((page) => toCrawlListItem(page, cap)),
		{ header: "Per-page details:", metadata },
	);
}

function toCrawlListItem(page: CrawlPageView, excerptCap = 180): ToolResourceListItem {
	const url = page.finalUrl ?? page.url ?? "unknown URL";
	if (page.error) return { ok: false, url, fields: {}, error: page.error };
	return {
		ok: true,
		url,
		finalUrl: page.finalUrl && page.url && page.finalUrl !== page.url ? page.finalUrl : undefined,
		title: page.data?.title,
		excerpt: toolPickExcerpt(
			page.data?.description,
			page.data?.markdown,
			page.data?.text,
			excerptCap,
		),
		fields: {
			status: page.status,
			mode: page.mode,
			format: page.format,
			contentType: page.contentType,
			downloadedBytes: page.downloadedBytes,
			durationMs: page.timing?.durationMs,
			cached: page.cache?.cached,
			staleness: page.cache?.staleness,
			truncated: page.truncated,
		},
	};
}

export function renderWebCrawlLookupResult(
	result: PiToolShell,
	expanded = false,
	theme?: RenderTheme,
): RenderComponent {
	const envelope = result.details as Partial<ToolContext<unknown>>;
	const summary = envelope.summary ?? result.content[0].text;
	return toolResultCard({
		renderContent(width) {
			const lines = [summary];
			if (expanded) {
				const sections = buildExpandedResultDetails(
					envelope as Record<string, unknown> | undefined,
				);
				const tree = toolResultTree(sections, width, theme);
				if (tree) lines.push("", tree);
				const ids = toolResultId([{ label: "responseId", id: envelope.responseId ?? "" }], theme);
				if (ids.length > 0) lines.push("", ...ids);
			}
			return lines.join("\n");
		},
		padToWidth: true,
	});
}

export function renderWebCrawlResult(
	result: PiToolShell,
	expanded = false,
	theme?: RenderTheme,
): RenderComponent {
	const details = result.details as Partial<ToolContext<unknown>> | ProgressDetails;
	if (isProgress(details)) {
		if (isBatchProgress(details)) return toolBatchProgressCard(details, expanded, theme);
		return toolProgressCard("web_crawl", details, theme, { allowIcons: true });
	}
	const envelope = details as Partial<ToolContext<{ metadata?: CrawlMeta; pages?: unknown[] }>>;
	const metadata = envelope.data?.metadata;
	const failed = metadata?.failedCount ?? 0;
	const summary = envelope.error
		? toolErrorLabel("web_crawl", envelope.error, { allowIcons: true })
		: toolStatus(
				[
					toolStatusMark("success", metadata?.succeededCount ?? 0, "succeeded", theme),
					toolStatusMark("failure", failed, "failed", theme),
					toolActivityCount(metadata?.visitedCount ?? 0, "visited", "◉", theme),
					toolNeutral(`→ frontier ${metadata?.frontierCount ?? 0}`, theme),
					metadata?.strategy
						? toolNeutral(
								`· ${formatCrawlStrategyLabel(metadata.strategy) ?? metadata.strategy} crawl`,
								theme,
							)
						: undefined,
					!expanded && { text: "(ctrl+o to expand)", tone: "muted" as const },
				],
				theme,
			);
	const pages = Array.isArray(envelope.data?.pages)
		? // oxlint-disable-next-line typescript/no-unnecessary-condition -- capture group/optional field may be undefined at runtime
			(envelope.data?.pages as CrawlPageView[])
		: [];
	const progress = isBatchProgressView(envelope.diagnostics?.batchProgress)
		? envelope.diagnostics.batchProgress
		: batchProgressFromCrawlPages(pages);
	return toolBatchResultCard(
		{
			progress,
			summary,
			notice: toolSessionNotice(envelope),
			preview: crawlExpandedDetails(pages, {
				jobId: envelope.diagnostics?.jobId,
				packageResponseId: toolContextPackageResponseId(envelope),
			}),
			responseId: envelope.responseId,
		},
		expanded,
		theme,
	);
}
