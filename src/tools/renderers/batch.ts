/**
 * @file Pi web_batch renderer — top-level result/progress card, batch progress state UI, and
 *   per-URL expanded details composer.
 */
import {
	batchProgressFromItems,
	isBatchProgress,
	isBatchProgressView,
} from "../../batch/progress-state.ts";
import type { BatchItemResult } from "../../batch/run.ts";
import type { LineMatch } from "../../scrape/line-filter.ts";
import { formatLineMatchPreview } from "../../scrape/line-preview.ts";
import { renderBatchProgressCard, renderBatchResultCard } from "../../tui/batch.ts";
import {
	activityCountSegment,
	failureCountSegment,
	successCountSegment,
} from "../../tui/counts.ts";
import {
	errorLabel,
	freshnessLabel,
	sessionNotice,
	contextPackageResponseId,
} from "../../tui/envelope.ts";
import { pickExcerpt } from "../../tui/preview.ts";
import { renderProgressCard } from "../../tui/progress.ts";
import { type ResourceListItem, renderResourceItemList } from "../../tui/resource.ts";
import { muted, separator } from "../../tui/theme.ts";
import type { RenderComponent, RenderTheme } from "../../tui/types.ts";
import {
	isProgress,
	type PiToolShell,
	type ProgressDetails,
	type ResultEnvelope,
} from "../../types.ts";

export interface BatchItem {
	ok?: boolean;
	url?: string;
	result?: {
		url?: string;
		finalUrl?: string;
		status?: number;
		mode?: string;
		format?: string;
		contentType?: string;
		downloadedBytes?: number;
		truncated?: boolean;
		timing?: { durationMs?: number; fetchMs?: number; parseMs?: number };
		cache?: { cached?: boolean; staleness?: string; ageSeconds?: number };
		data?: {
			title?: string;
			description?: string;
			markdown?: string;
			text?: string;
			route?: string;
			matches?: LineMatch[];
		};
	};
	error?: { code?: string; phase?: string; message?: string };
}

export function batchExpandedDetails(
	items: readonly BatchItem[],
	metadata: { jobId?: unknown; packageResponseId?: unknown } = {},
): string {
	const cap = excerptCapForCount(items.length);
	return renderResourceItemList(
		items.map((item) => toBatchListItem(item, cap)),
		{
			header: "Per-URL details:",
			metadata,
		},
	);
}

function excerptCapForCount(count: number): number {
	return Math.max(100, Math.min(500, Math.floor(1000 / Math.max(1, count))));
}

function toBatchListItem(item: BatchItem, excerptCap = 180): ResourceListItem {
	if (!item.ok) {
		return {
			ok: false,
			url: item.url ?? "unknown URL",
			fields: {},
			error: item.error,
		};
	}
	const result = item.result;
	const url = item.url ?? result?.url ?? "unknown URL";
	const matchPreview = formatLineMatchPreview(result?.data?.matches, {
		maxChars: excerptCap,
		maxMatches: 3,
	});
	return {
		ok: true,
		url,
		finalUrl: result?.finalUrl,
		title: result?.data?.title,
		excerpt:
			matchPreview ??
			pickExcerpt(
				result?.data?.description,
				result?.data?.markdown,
				result?.data?.text,
				result?.data?.route,
				excerptCap,
			),
		fields: {
			status: result?.status,
			mode: result?.mode,
			format: result?.format,
			contentType: result?.contentType,
			downloadedBytes: result?.downloadedBytes,
			durationMs: result?.timing?.durationMs,
			cached: result?.cache?.cached,
			staleness: result?.cache?.staleness,
			truncated: result?.truncated,
		},
	};
}

export function renderWebBatchResult(
	result: PiToolShell,
	expanded = false,
	theme?: RenderTheme,
): RenderComponent {
	const details = result.details as Partial<ResultEnvelope<unknown>> | ProgressDetails;
	if (isProgress(details)) {
		if (isBatchProgress(details)) return renderBatchProgressCard(details, expanded, theme);
		return renderProgressCard("web_batch", details, theme, {
			allowIcons: true,
		});
	}
	const envelope = details as Partial<ResultEnvelope<BatchItemResult[]>>;
	const items = Array.isArray(envelope.data) ? envelope.data : [];
	const succeeded = items.filter((item) => item.ok).length;
	const failed = items.length - succeeded;
	// oxlint-disable-next-line typescript/no-unnecessary-condition -- capture group/optional field may be undefined at runtime
	const cacheHits = items.filter((item) => item.ok && item.result?.cache?.cached).length;
	const summary = envelope.error
		? errorLabel("web_batch", envelope.error, { allowIcons: true })
		: [
				successCountSegment(succeeded, "succeeded", theme),
				failureCountSegment(failed, "failed", theme),
				activityCountSegment(cacheHits, "cache hits", "ⓞ", theme),
				freshnessLabel(envelope),
				!expanded ? muted("(ctrl+o to expand)", theme) : undefined,
			]
				.filter(Boolean)
				.join(separator(theme));
	const progressValue = envelope.diagnostics?.batchProgress;
	const progress = isBatchProgressView(progressValue)
		? progressValue
		: batchProgressFromItems(items);
	return renderBatchResultCard(
		{
			progress,
			summary,
			notice: sessionNotice(envelope),
			preview: batchExpandedDetails(items, {
				jobId: envelope.diagnostics?.jobId,
				packageResponseId: contextPackageResponseId(envelope),
			}),
			responseId: envelope.responseId,
			padToWidth: false,
		},
		expanded,
		theme,
	);
}
