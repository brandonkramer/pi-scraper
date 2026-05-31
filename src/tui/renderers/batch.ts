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
import {
	isProgress,
	type PiToolShell,
	type ProgressDetails,
	type ToolContext,
} from "../../types.ts";
import { toolBatchProgressCard, toolBatchResultCard, toolProgressCard } from "../tool-card.ts";
import { toolFormatBytes, toolFormatDuration } from "../tool-format.ts";
import {
	toolContextPackageResponseId,
	toolErrorLabel,
	toolFreshnessLabel,
	toolSessionNotice,
} from "../tool-labels.ts";
import { buildToolResultTree, toolResultTree, type ToolResultGroup } from "../tool-result-tree.ts";
import { toolResultId } from "../tool-result.ts";
import { toolStatusMark, toolStatus } from "../tool-status.ts";
import type { RenderComponent, RenderTheme } from "../types.ts";

export interface BatchItem {
	ok?: boolean;
	url?: string;
	result?: BatchItemRenderResult;
	error?: { code?: string; phase?: string; message?: string };
}

interface BatchItemRenderResult {
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
}

export function batchExpandedSections(
	items: readonly BatchItem[],
	metadata: { jobId?: unknown; packageResponseId?: unknown },
	width: number,
	theme?: RenderTheme,
): string[] {
	const groups = items.map((item) => batchItemGroup(item));
	const result = [toolResultTree(buildToolResultTree(groups), width, theme)];
	const jobId = typeof metadata.jobId === "string" ? metadata.jobId : undefined;
	const pkg =
		typeof metadata.packageResponseId === "string" ? metadata.packageResponseId : undefined;
	const ids = toolResultId(
		[
			{ label: "jobId", id: jobId ?? "" },
			{ label: "packageResponseId", id: pkg ?? "" },
		],
		theme,
	);
	if (ids.length > 0) result.push("", ...ids);
	return result;
}

function batchItemGroup(item: BatchItem): ToolResultGroup {
	const url = item.url ?? item.result?.url ?? "unknown URL";
	const r = item.result;
	const rows: ToolResultGroup["rows"] = [];
	if (item.ok) {
		rows.push(["status", r?.status ? String(r.status) : undefined]);
		rows.push(["mode", r?.mode]);
		rows.push(["format", r?.format]);
		if (r?.downloadedBytes !== undefined)
			rows.push(["size", toolFormatBytes(r.downloadedBytes) ?? ""]);
		if (r?.timing?.durationMs !== undefined)
			rows.push(["duration", toolFormatDuration(r.timing.durationMs) ?? ""]);
		rows.push(["title", r?.data?.title]);
		if (r?.data?.matches?.length)
			rows.push([
				"matches",
				formatLineMatchPreview(r.data.matches, { maxChars: 200, maxMatches: 3 }),
			]);
	} else if (item.error) {
		rows.push(["code", item.error.code]);
		rows.push(["message", item.error.message]);
	}
	return { name: url, rows };
}

export function renderWebBatchResult(
	result: PiToolShell,
	expanded = false,
	theme?: RenderTheme,
): RenderComponent {
	const details = result.details as Partial<ToolContext<unknown>> | ProgressDetails;
	if (isProgress(details)) {
		if (isBatchProgress(details)) return toolBatchProgressCard(details, expanded, theme);
		return toolProgressCard("web_batch", details, theme, { allowIcons: true });
	}
	const envelope = details as Partial<ToolContext<BatchItemResult[]>>;
	const items = Array.isArray(envelope.data) ? envelope.data : [];
	const succeeded = items.filter((item) => item.ok).length;
	const failed = items.length - succeeded;
	// oxlint-disable-next-line typescript/no-unnecessary-condition -- capture group/optional field may be undefined at runtime
	const cacheHits = items.filter((item) => item.ok && item.result?.cache?.cached).length;
	const summary = envelope.error
		? toolErrorLabel("web_batch", envelope.error, { allowIcons: true })
		: toolStatus(
				[
					toolStatusMark("success", succeeded, "succeeded", theme),
					toolStatusMark("failure", failed, "failed", theme),
					toolStatusMark("cache", cacheHits, "cache hits", theme),
					toolFreshnessLabel(envelope),
					!expanded && { text: "(ctrl+o to expand)", tone: "muted" as const },
				],
				theme,
			);
	const progressValue = envelope.diagnostics?.batchProgress;
	const progress = isBatchProgressView(progressValue)
		? progressValue
		: batchProgressFromItems(items);
	const metadata = {
		jobId: envelope.diagnostics?.jobId,
		packageResponseId: toolContextPackageResponseId(envelope),
	};
	return toolBatchResultCard(
		{
			progress,
			summary,
			notice: toolSessionNotice(envelope),
			expandedSections: (width) => batchExpandedSections(items, metadata, width, theme),
			responseId: envelope.responseId,
			padToWidth: false,
		},
		expanded,
		theme,
	);
}
