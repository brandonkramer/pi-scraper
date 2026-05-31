import {
	batchProgressFromCrawlPages,
	isBatchProgress,
	isBatchProgressView,
} from "../../batch/progress-state.ts";
import type { CrawlRunResult } from "../../crawl/runner.ts";
import { formatCrawlStrategyLabel } from "../../crawl/state.ts";
/** @file Pi web_crawl renderer — top-level result/progress card and per-page expanded details. */
import {
	isProgress,
	type PiToolShell,
	type ProgressDetails,
	type ToolContext,
} from "../../types.ts";
import { neutral as toolNeutral } from "../theme.ts";
import {
	toolBatchProgressCard,
	toolBatchResultCard,
	toolProgressCard,
	toolResultCard,
} from "../tool-card.ts";
import { toolContextPackageResponseId, toolErrorLabel, toolSessionNotice } from "../tool-labels.ts";
import { renderResourceItemList as toolResourceList } from "../tool-resource.ts";
import { toolResultTree } from "../tool-result-tree.ts";
import { buildExpandedResultDetails, toolResultId } from "../tool-result.ts";
import {
	toolStatusMark,
	toolStatus,
	activityCountSegment as toolActivityCount,
} from "../tool-status.ts";
import type { RenderComponent, RenderTheme } from "../types.ts";
export type CrawlPageView = Partial<CrawlRunResult["pages"][number]>;

export function crawlExpandedDetails(
	pages: readonly CrawlPageView[],
	metadata: { jobId?: unknown; packageResponseId?: unknown } = {},
): string {
	const cap = Math.max(100, Math.min(500, Math.floor(1000 / Math.max(1, pages.length))));
	return toolResourceList(
		pages.map((page) => {
			const url = page.finalUrl ?? page.url ?? "unknown URL";
			if (page.error) return { ok: false, url, fields: {}, error: page.error };
			return {
				ok: true,
				url,
				finalUrl:
					page.finalUrl && page.url && page.finalUrl !== page.url ? page.finalUrl : undefined,
				title: page.data?.title,
				excerpt: (() => {
					const v = [page.data?.description, page.data?.markdown, page.data?.text].find(Boolean);
					return v ? v.replaceAll(/\s+/gu, " ").trim().slice(0, cap) : undefined;
				})(),
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
		}),
		{ header: "Per-page details:", metadata },
	);
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
				const sections = buildExpandedResultDetails(envelope as Record<string, unknown>);
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
	const envelope = details as Partial<ToolContext<Partial<CrawlRunResult>>>;
	const data = envelope.data;
	const metadata = data?.metadata;
	const strategy = metadata?.strategy;
	const failed = metadata?.failedCount ?? 0;
	const summary = envelope.error
		? toolErrorLabel("web_crawl", envelope.error, { allowIcons: true })
		: toolStatus(
				[
					toolStatusMark("success", metadata?.succeededCount ?? 0, "succeeded", theme),
					toolStatusMark("failure", failed, "failed", theme),
					toolActivityCount(metadata?.visitedCount ?? 0, "visited", "◉", theme),
					toolNeutral(`→ frontier ${metadata?.frontierCount ?? 0}`, theme),
					strategy
						? toolNeutral(`· ${formatCrawlStrategyLabel(strategy) ?? strategy} crawl`, theme)
						: undefined,
					!expanded && { text: "(ctrl+o to expand)", tone: "muted" as const },
				],
				theme,
			);
	const pages = Array.isArray(data?.pages) ? (data.pages as CrawlPageView[]) : [];
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
