/**
 * @fileoverview Batch progress and result card UI rendering.
 */
import type { ProgressDetails } from "../types.ts";
import type { RenderComponent, RenderTheme } from "../tui/types.ts";
import { renderText } from "./render.ts";
import { muted } from "../tui/theme.ts";
import { renderProgressBar } from "../tui/progress-bar.ts";
import { renderStatusPill } from "../tui/status-pill.ts";
import { renderUrlStatusRow } from "../tui/rows.ts";
import { renderStackedResultCard } from "../tui/cards.ts";
import { withSpinnerFooter } from "../tui/spinner.ts";
import type {
	BatchProgressItemView,
	BatchProgressStatus,
	BatchProgressView,
} from "./web-batch-progress.ts";

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
