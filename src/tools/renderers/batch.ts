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
import { formatBytes, formatDuration } from "../../tui/format.ts";
import { renderProgressCard } from "../../tui/progress.ts";
import { muted, separator } from "../../tui/theme.ts";
import { renderTreeSections, type TreeSection } from "../../tui/tree.ts";
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

export function batchExpandedSections(
	items: readonly BatchItem[],
	metadata: { jobId?: unknown; packageResponseId?: unknown },
	width: number,
	theme?: RenderTheme,
): string[] {
	const sections: TreeSection[] = [];

	for (const item of items) {
		const url = item.url ?? item.result?.url ?? "unknown URL";

		/* url section header */
		const sec: TreeSection = { name: url, rows: [] };
		sections.push(sec);

		if (item.ok) {
			if (item.result?.status) sec.rows.push({ key: "status", value: String(item.result.status) });
			if (item.result?.mode) sec.rows.push({ key: "mode", value: item.result.mode });
			if (item.result?.format) sec.rows.push({ key: "format", value: item.result.format });
			if (item.result?.downloadedBytes !== undefined)
				sec.rows.push({
					key: "size",
					value: formatBytes(item.result.downloadedBytes) ?? "",
				});
			if (item.result?.timing?.durationMs !== undefined)
				sec.rows.push({
					key: "duration",
					value: formatDuration(item.result.timing.durationMs) ?? "",
				});
			if (item.result?.data?.title) sec.rows.push({ key: "title", value: item.result.data.title });
			/* match preview */
			if (item.result?.data?.matches && item.result.data.matches.length > 0) {
				const excerpt = formatLineMatchPreview(item.result.data.matches, {
					maxChars: 200,
					maxMatches: 3,
				});
				if (excerpt) sec.rows.push({ key: "matches", value: excerpt });
			}
		} else if (item.error) {
			if (item.error.code) sec.rows.push({ key: "code", value: item.error.code });
			if (item.error.message) sec.rows.push({ key: "message", value: item.error.message });
		}
	}

	const result = [renderTreeSections(sections, width, theme)];

	const jobId = typeof metadata.jobId === "string" ? metadata.jobId : undefined;
	const packageResponseId =
		typeof metadata.packageResponseId === "string" ? metadata.packageResponseId : undefined;
	if (jobId || packageResponseId) {
		result.push("");
		if (jobId) result.push(muted(`jobId: ${jobId}`, theme));
		if (packageResponseId) result.push(muted(`packageResponseId: ${packageResponseId}`, theme));
	}

	return result;
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
				activityCountSegment(cacheHits, "cache hits", "↻", theme),
				freshnessLabel(envelope),
				!expanded ? muted("(ctrl+o to expand)", theme) : undefined,
			]
				.filter(Boolean)
				.join(separator(theme));
	const progressValue = envelope.diagnostics?.batchProgress;
	const progress = isBatchProgressView(progressValue)
		? progressValue
		: batchProgressFromItems(items);
	const metadata = {
		jobId: envelope.diagnostics?.jobId,
		packageResponseId: contextPackageResponseId(envelope),
	};
	return renderBatchResultCard(
		{
			progress,
			summary,
			notice: sessionNotice(envelope),
			expandedSections: (width) => batchExpandedSections(items, metadata, width, theme),
			responseId: envelope.responseId,
			padToWidth: false,
		},
		expanded,
		theme,
	);
}
