import type {
	BatchProgressItemView,
	BatchProgressStatus,
	BatchProgressView,
} from "../batch/progress-state.ts";
/** @file Batch-progress result and progress cards shared by web_batch and web_crawl. */
import type { ProgressDetails } from "../types.ts";
import { renderStatusPill } from "./pill.ts";
import { renderProgressBar } from "./progress.ts";
import { defineResultRenderer } from "./result-renderer.ts";
import { renderUrlStatusRow } from "./rows.ts";
import { withSpinnerFooter } from "./spinner.ts";
import { renderStackedResultCard } from "./stacked.ts";
import { muted } from "./theme.ts";
import type { RenderComponent, RenderTheme } from "./types.ts";

export function renderBatchProgressCard(
	details: ProgressDetails<{ batchProgress: BatchProgressView; spinnerTick?: number }>,
	expanded: boolean,
	theme?: RenderTheme,
): RenderComponent {
	const batch = details.data?.batchProgress;
	const tick = details.data?.spinnerTick;
	return defineResultRenderer({
		renderContent(width) {
			const text = batch
				? renderBatchProgressText(batch, width, expanded, theme)
				: muted("No batch progress available.", theme);
			const isDone = batch ? batch.completed >= batch.total : false;
			const lines = text.split("\n");
			return isDone ? lines.join("\n") : withSpinnerFooter(lines, tick);
		},
	});
}

export interface BatchResultCardOptions {
	progress: BatchProgressView;
	summary: string;
	notice?: string;
	preview?: string;
	markdownPreview?: (width: number) => RenderComponent | undefined;
	expandedSections?: (width: number) => string[];
	responseId?: string;
	padToWidth?: boolean;
}

export function renderBatchResultCard(
	options: BatchResultCardOptions,
	expanded: boolean,
	theme?: RenderTheme,
): RenderComponent {
	return renderStackedResultCard(
		{
			...options,
			body: (width) => renderBatchProgressText(options.progress, width, expanded, theme),
			expanded,
			expandedSections: (width) => [
				...(options.preview ? [options.preview] : []),
				...(options.expandedSections?.(width) ?? []),
			],
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
	const title = `${muted("\u2514\u2500 ", theme)}${theme?.bold?.(label) ?? label} · ${[
		muted(`${batch.completed}/${batch.total} done`, theme),
		muted(`ok ${batch.succeeded}`, theme),
		muted(`err ${batch.failed}`, theme),
		muted(`concurrency ${batch.concurrency}`, theme),
	].join(" · ")}`;
	const rows = batch.items
		.slice(0, expanded ? batch.items.length : 12)
		.map((item) => renderBatchRow(item, width, theme));
	const more =
		!expanded && batch.items.length > rows.length
			? [muted(`… ${batch.items.length - rows.length} more urls`, theme)]
			: [];
	return [title, ...rows, ...more].join("\n");
}

function renderBatchRow(item: BatchProgressItemView, width: number, theme?: RenderTheme): string {
	const statusWidth = Math.max(12, Math.min(18, Math.floor(width * 0.22)));
	const state = statusState(item.status);
	return renderUrlStatusRow({
		url: item.url,
		label: state,
		state,
		width,
		theme,
		startedAtMs: item.startedAtMs,
		statusBox: renderStatusBox(item, statusWidth, theme),
	});
}

function renderStatusBox(item: BatchProgressItemView, width: number, theme?: RenderTheme): string {
	if (item.status === "processing" && typeof item.progress === "number")
		return renderProgressBar(item.progress, width - 2);
	const state = statusState(item.status);
	return renderStatusPill({ label: state, state, width, theme, startedAtMs: item.startedAtMs });
}

function statusState(status: BatchProgressStatus) {
	if (status === "queued") return "waiting";
	if (status === "processing") return "loading";
	return status;
}
