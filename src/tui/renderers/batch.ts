import {
	batchProgressFromItems,
	isBatchProgress,
	isBatchProgressView,
} from "../../batch/progress-state.ts";
import type { BatchItemResult } from "../../batch/run.ts";
import { formatLineMatchPreview } from "../../scrape/line-preview.ts";
import {
	isProgress,
	type PiToolShell,
	type ProgressDetails,
	type ToolContext,
} from "../../types.ts";
import { toolBatchProgressCard, toolBatchResultCard, toolProgressCard } from "../tool-card.ts";
import {
	toolContextPackageResponseId,
	toolErrorLabel,
	toolExpandHint,
	toolFreshnessLabel,
	toolSessionNotice,
} from "../tool-labels.ts";
import { formatBytes as fmtBytes, formatDuration as fmtDuration } from "../tool-resource.ts";
import { buildToolResultTree, toolResultTree, type ToolResultGroup } from "../tool-result-tree.ts";
import { toolResultId } from "../tool-result.ts";
import { countSegments as count, toolStatus } from "../tool-status.ts";
import type { RenderComponent, RenderTheme } from "../types.ts";

export type BatchItem = Partial<Omit<BatchItemResult, "result" | "error">> & {
	result?: Partial<Extract<BatchItemResult, { ok: true }>["result"]>;
	error?: Partial<Extract<BatchItemResult, { ok: false }>["error"]>;
};

export function batchExpandedSections(
	items: readonly BatchItem[],
	m: { jobId?: unknown; packageResponseId?: unknown },
	width: number,
	theme?: RenderTheme,
): string[] {
	const groups = items.map((item) => batchItemGroup(item));
	const result = [toolResultTree(buildToolResultTree(groups), width, theme)];
	const jobId = typeof m.jobId === "string" ? m.jobId : undefined;
	const pkg = typeof m.packageResponseId === "string" ? m.packageResponseId : undefined;
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
		rows.push(["size", fmtBytes(r?.downloadedBytes)]);
		rows.push(["duration", fmtDuration(r?.timing?.durationMs)]);
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
	const cacheHits = items.filter((item) => item.ok && item["result"]?.cache?.cached).length;
	const summary = envelope.error
		? toolErrorLabel("web_batch", envelope.error, { allowIcons: true })
		: toolStatus(
				[
					count.success(succeeded, "succeeded", theme),
					count.failure(failed, "failed", theme),
					count.activity(cacheHits, "cache hits", "\u21BB", theme),
					toolFreshnessLabel(envelope),
					!expanded && toolExpandHint,
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
