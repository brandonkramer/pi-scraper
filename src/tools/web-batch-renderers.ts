/**
 * @fileoverview Pi web_batch renderer — top-level result/progress card, batch progress state UI, and per-URL expanded details composer.
 */
import {
	isProgress,
	type PiToolShell,
	type ProgressDetails,
	type ResultEnvelope,
} from "../types.ts";
import type { RenderComponent, RenderTheme } from "../tui/types.ts";
import { renderText } from "../tui/text.ts";
import { metadataText, muted, separator } from "../tui/theme.ts";
import { renderProgressBar } from "../tui/progress-bar.ts";
import { renderStatusPill } from "../tui/status-pill.ts";
import { renderUrlStatusRow } from "../tui/rows.ts";
import { renderStackedResultCard } from "../tui/cards.ts";
import { withSpinnerFooter } from "../tui/spinner.ts";
import type {
	BatchProgressItemView,
	BatchProgressStatus,
	BatchProgressView,
} from "../batch/progress-state.ts";
import {
	batchProgressFromItems,
	isBatchProgress,
	isBatchProgressView,
} from "../batch/progress-state.ts";
import type { BatchItem } from "./web-renderer-views.ts";
import { formatResourceFields } from "../tui/resource-fields.ts";
import {
	activityCountSegment,
	failureCountSegment,
	successCountSegment,
} from "../tui/counts.ts";
import {
	errorTitle,
	freshnessLabel,
	sessionNotice,
	contextPackageResponseId,
} from "../tui/envelope-labels.ts";
import { renderProgress } from "../tui/progress-card.ts";

export function renderBatchProgressCard(
	details: ProgressDetails<{
		batchProgress: BatchProgressView;
		spinnerTick?: number;
	}>,
	expanded: boolean,
	theme?: RenderTheme,
): RenderComponent {
	const batch = details.data?.batchProgress;
	const tick = details.data?.spinnerTick;
	return {
		render(width: number) {
			const text = batch
				? renderBatchProgressText(batch, width, expanded, theme)
				: muted("No batch progress available.", theme);
			const isDone = batch ? batch.completed >= batch.total : false;
			const lines = text.split("\n");
			if (!isDone) {
				return renderText(withSpinnerFooter(lines, tick)).render(width);
			}
			return renderText(lines.join("\n")).render(width);
		},
		invalidate() {},
	};
}

export function renderBatchResultCard(
	options: {
		progress: BatchProgressView;
		summary: string;
		notice?: string;
		preview?: string;
		responseId?: string;
		padToWidth?: boolean;
	},
	expanded: boolean,
	theme?: RenderTheme,
): RenderComponent {
	return renderStackedResultCard(
		{
			body: (width) =>
				renderBatchProgressText(options.progress, width, expanded, theme),
			summary: options.summary,
			expanded,
			notice: options.notice,
			expandedSections: () => [options.preview?.slice(0, 500)],
			responseId: options.responseId,
			padToWidth: options.padToWidth,
		},
		theme,
	);
}

function renderBatchProgressText(
	batch: BatchProgressView,
	width: number,
	expanded: boolean,
	theme?: RenderTheme,
): string {
	const label = batch.label ?? "web_batch";
	const title = [
		theme?.bold?.(label) ?? label,
		muted(`${batch.completed}/${batch.total} done`, theme),
		muted(`ok ${batch.succeeded}`, theme),
		muted(`err ${batch.failed}`, theme),
		muted(`concurrency ${batch.concurrency}`, theme),
	].join(" · ");
	const rows = batch.items
		.slice(0, expanded ? batch.items.length : 12)
		.map((item) => renderBatchRow(item, width, theme));
	const more =
		!expanded && batch.items.length > rows.length
			? [muted(`… ${batch.items.length - rows.length} more urls`, theme)]
			: [];
	return [title, ...rows, ...more].join("\n");
}

function renderBatchRow(
	item: BatchProgressItemView,
	width: number,
	theme?: RenderTheme,
): string {
	const statusWidth = Math.max(12, Math.min(18, Math.floor(width * 0.22)));
	return renderUrlStatusRow({
		url: item.url,
		label: statusLabel(item.status),
		state: statusPillState(item.status),
		width,
		theme,
		startedAtMs: item.startedAtMs,
		statusBox: renderStatusBox(item, statusWidth, theme),
	});
}

function renderStatusBox(
	item: BatchProgressItemView,
	width: number,
	theme?: RenderTheme,
): string {
	if (item.status === "processing" && typeof item.progress === "number") {
		return renderProgressBar(item.progress, width - 2);
	}
	return renderStatusPill({
		label: statusLabel(item.status),
		state: statusPillState(item.status),
		width,
		theme,
		startedAtMs: item.startedAtMs,
	});
}

function statusPillState(status: BatchProgressStatus) {
	if (status === "queued") return "waiting";
	if (status === "processing") return "loading";
	return status;
}

function statusLabel(status: BatchProgressStatus): string {
	if (status === "queued") return "waiting";
	if (status === "processing") return "loading";
	return status;
}

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

export function renderWebBatchResult(
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
		return renderProgress("web_batch", details, theme, {
			allowIcons: true,
		});
	}
	const envelope = details as Partial<
		ResultEnvelope<import("../batch/run.ts").BatchItemResult[]>
	>;
	const items = Array.isArray(envelope.data) ? envelope.data : [];
	const succeeded = items.filter((item) => item.ok === true).length;
	const failed = items.length - succeeded;
	const cacheHits = items.filter(
		(item) => item.ok === true && item.result?.cache?.cached,
	).length;
	const summary = envelope.error
		? errorTitle("web_batch", envelope.error, { allowIcons: true })
		: [
				successCountSegment(succeeded, "succeeded", theme),
				failureCountSegment(failed, "failed", theme),
				activityCountSegment(cacheHits, "cache hits", "ⓞ", theme),
				freshnessLabel(envelope),
				!expanded ? metadataText("(ctrl+o to expand)", theme) : undefined,
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
