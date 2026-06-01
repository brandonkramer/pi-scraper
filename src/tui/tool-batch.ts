import type { BatchProgressView } from "../batch/progress-state.ts";
import type { ProgressDetails } from "../types.ts";
import { toolCallStatus } from "./tool-call.ts";
import { defineResultRenderer, progressPillState, toolProgressLayout } from "./tool-progress.ts";
import { toolResourceStatus } from "./tool-resource.ts";
import { withSpinnerFooter } from "./tool-spinner.ts";
import { renderStatusPill } from "./tool-status.ts";
import { muted } from "./tui.ts";
import type { RenderComponent, RenderTheme } from "./types.ts";

/**
 * Renders the live batch/crawl row list from a `batchProgress` progress envelope.
 *
 * Example output, with spinner footer while incomplete:
 *
 * ```txt
 * └─ web_batch · 1/3 done · ok 1 · err 0 · concurrency 2
 * ✓ https://a.test [ done ]
 * ⠴ https://b.test [ loading ]
 * · https://c.test [ waiting ]
 *
 * ⠋ Working...
 * ```
 */
export function toolBatchProgress(
	details: ProgressDetails<{ batchProgress: BatchProgressView; spinnerTick?: number }>,
	expanded: boolean,
	theme?: RenderTheme,
): RenderComponent {
	const batch = details.data?.batchProgress;
	return defineResultRenderer({
		renderContent(width) {
			const text = batch
				? renderBatchProgressText(batch, width, expanded, theme, "toolPendingBg")
				: muted("No batch progress available.", theme);
			return batch && batch.completed >= batch.total
				? text
				: withSpinnerFooter(text.split("\n"), details.data?.spinnerTick);
		},
	});
}

/**
 * Renders the completed batch/crawl result using the shared result layout.
 *
 * The body is the same row list as progress, but the surrounding background is restored to success
 * and expanded sections can add per-item details/handles.
 */
export function toolBatchResult(
	options: {
		progress: BatchProgressView;
		summary: string;
		notice?: string;
		preview?: string;
		markdownPreview?: (width: number) => RenderComponent | undefined;
		expandedSections?: (width: number) => string[];
		responseId?: string;
		padToWidth?: boolean;
	},
	expanded: boolean,
	theme?: RenderTheme,
): RenderComponent {
	return toolProgressLayout(
		{
			...options,
			body: (width) =>
				renderBatchProgressText(options.progress, width, expanded, theme, "toolSuccessBg"),
			expanded,
			expandedSections: (width) => [options.preview, ...(options.expandedSections?.(width) ?? [])],
		},
		theme,
	);
}

function renderBatchProgressText(
	batch: BatchProgressView,
	width: number,
	expanded: boolean,
	theme?: RenderTheme,
	restoreBg?: string,
): string {
	const label = batch.label ?? "web_batch";
	const title = toolCallStatus(
		theme?.bold?.(label) ?? label,
		[
			{ text: `${batch.completed}/${batch.total} done`, tone: "muted" },
			{ text: `ok ${batch.succeeded}`, tone: "muted" },
			{ text: `err ${batch.failed}`, tone: "muted" },
			{ text: `concurrency ${batch.concurrency}`, tone: "muted" },
		],
		theme,
	);
	const rows = batch.items.slice(0, expanded ? undefined : 12).map((item) => {
		const sbWidth = Math.max(12, Math.min(18, Math.floor(width * 0.22)));
		const bState = progressPillState(item.status);
		const statusBox =
			item.status === "processing" && typeof item.progress === "number"
				? progressBar(item.progress, sbWidth)
				: renderStatusPill({
						label: bState,
						state: bState,
						width: sbWidth,
						theme,
						startedAtMs: item.startedAtMs,
						restoreBg,
					});
		return toolResourceStatus({
			url: item.url,
			label: bState,
			state: bState,
			width,
			theme,
			startedAtMs: item.startedAtMs,
			statusBox,
			restoreBg,
		});
	});
	if (!expanded && batch.items.length > rows.length)
		rows.push(muted(`… ${batch.items.length - rows.length} more urls`, theme));
	return [title, ...rows].join("\n");
}

function progressBar(progress: number, width: number): string {
	const filled = Math.round(Math.max(0, Math.min(1, progress)) * (width - 2));
	return `[${"=".repeat(Math.max(0, filled - 1))}${filled > 0 ? ">" : ""}${" ".repeat(Math.max(0, width - 2 - filled))}]`;
}
