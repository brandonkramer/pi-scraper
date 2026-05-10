/**
 * @fileoverview Pi web_crawl renderer — top-level result/progress card and per-page expanded details.
 */
import {
	isProgress,
	type PiToolShell,
	type ProgressDetails,
	type ResultEnvelope,
} from "../../types.ts";
import type { RenderComponent, RenderTheme } from "../../tui/types.ts";
import { renderProgressCard } from "../../tui/progress.ts";
import {
	renderBatchProgressCard,
	renderBatchResultCard,
} from "../../tui/batch.ts";
import {
	batchProgressFromCrawlPages,
	isBatchProgress,
	isBatchProgressView,
} from "../../batch/progress-state.ts";
import {
	activityCountSegment,
	failureCountSegment,
	successCountSegment,
} from "../../tui/counts.ts";
import { pickExcerpt } from "../../tui/preview.ts";
import { muted, neutral, separator } from "../../tui/theme.ts";
import {
	errorLabel,
	sessionNotice,
	contextPackageResponseId,
} from "../../tui/envelope.ts";
export interface CrawlMeta {
	succeededCount: number;
	failedCount: number;
	visitedCount: number;
	frontierCount: number;
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
import {
	type ResourceListItem,
	renderResourceItemList,
} from "../../tui/resource.ts";

export function crawlExpandedDetails(
	pages: readonly CrawlPageView[],
	metadata: { jobId?: unknown; packageResponseId?: unknown } = {},
): string {
	const cap = excerptCapForCount(pages.length);
	return renderResourceItemList(
		pages.map((page) => toCrawlListItem(page, cap)),
		{
			header: "Per-page details:",
			metadata,
		},
	);
}

function excerptCapForCount(count: number): number {
	return Math.max(100, Math.min(500, Math.floor(1000 / Math.max(1, count))));
}

function toCrawlListItem(
	page: CrawlPageView,
	excerptCap = 180,
): ResourceListItem {
	if (page.error) {
		return {
			ok: false,
			url: page.finalUrl ?? page.url ?? "unknown URL",
			fields: {},
			error: page.error,
		};
	}
	const url = page.finalUrl ?? page.url ?? "unknown URL";
	return {
		ok: true,
		url,
		finalUrl:
			page.finalUrl && page.url && page.finalUrl !== page.url
				? page.finalUrl
				: undefined,
		title: page.data?.title,
		excerpt: pickExcerpt(
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
		return renderProgressCard("web_crawl", details, theme, {
			allowIcons: true,
		});
	}
	const envelope = details as Partial<
		ResultEnvelope<{ metadata?: CrawlMeta; pages?: unknown[] }>
	>;
	const metadata = envelope.data?.metadata;
	const failed = metadata?.failedCount ?? 0;
	const summary = envelope.error
		? errorLabel("web_crawl", envelope.error, { allowIcons: true })
		: [
				successCountSegment(metadata?.succeededCount ?? 0, "succeeded", theme),
				failureCountSegment(failed, "failed", theme),
				activityCountSegment(
					metadata?.visitedCount ?? 0,
					"visited",
					"◉",
					theme,
				),
				neutral(`→ frontier ${metadata?.frontierCount ?? 0}`, theme),
				!expanded ? muted("(ctrl+o to expand)", theme) : undefined,
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
