import type { Component } from "@earendil-works/pi-tui";

import type { BatchProgressView } from "../batch/progress-state.ts";
import type { ProgressDetails, ToolContext } from "../types.ts";
import { muted } from "./theme.ts";
import { renderDynamicText, renderText } from "./tool-call.ts";
import { formatChecklistText } from "./tool-labels.ts";
import { toolProcess, withSpinnerFooter } from "./tool-process.ts";
import { toolResourceStatus, formatBytes } from "./tool-resource.ts";
import {
	type StatusPillState,
	renderStatusGlyph,
	renderStatusPill,
	paintFirstLineBg,
	countSegments as c,
} from "./tool-status.ts";
import type { RenderComponent, RenderTheme } from "./types.ts";

export function toolFileResultCard(
	envelope: Partial<ToolContext<Record<string, unknown>>>,
	theme?: RenderTheme,
): RenderComponent {
	const data = envelope.data;
	const file = (data?.file ?? {}) as {
		path?: string;
		downloadedBytes?: number;
		contentType?: string;
	};
	const fileSize = stringValue(data?.fileSize) ?? formatBytes(file.downloadedBytes) ?? "unknown";
	const filePath = stringValue(data?.filePath) ?? file.path ?? "unknown";
	const mimeType = stringValue(data?.mimeType) ?? file.contentType;
	return renderDynamicText(
		() =>
			[
				muted(`File size: ${fileSize}`, theme),
				...(mimeType ? [muted(`Mime type: ${mimeType}`, theme)] : []),
				muted(`File path: ${filePath}`, theme),
			].join("\n"),
		{ padToWidth: true },
	);
}

function stringValue(value: unknown): string | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	return JSON.stringify(value);
}

export function toolBatchProgressCard(
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
			const isDone = batch ? batch.completed >= batch.total : false;
			return isDone ? text : withSpinnerFooter(text.split("\n"), details.data?.spinnerTick);
		},
	});
}

export function toolBatchResultCard(
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
	return toolStackedCard(
		{
			...options,
			body: (width) =>
				renderBatchProgressText(options.progress, width, expanded, theme, "toolSuccessBg"),
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
	restoreBg?: string,
): string {
	const label = batch.label ?? "web_batch";
	const title = toolProcess(
		theme?.bold?.(label) ?? label,
		[
			{ text: `${batch.completed}/${batch.total} done`, tone: "muted" },
			{ text: `ok ${batch.succeeded}`, tone: "muted" },
			{ text: `err ${batch.failed}`, tone: "muted" },
			{ text: `concurrency ${batch.concurrency}`, tone: "muted" },
		],
		theme,
	);
	const rows = batch.items.slice(0, expanded ? batch.items.length : 12).map((item) => {
		const sbWidth = Math.max(12, Math.min(18, Math.floor(width * 0.22)));
		const bState: StatusPillState = progressPillState(item.status);
		const statusBox =
			item.status === "processing" && typeof item.progress === "number"
				? (() => {
						const filled = Math.round(Math.max(0, Math.min(1, item.progress)) * (sbWidth - 2));
						return `[${"=".repeat(Math.max(0, filled - 1))}${filled > 0 ? ">" : ""}${" ".repeat(Math.max(0, sbWidth - 2 - filled))}]`;
					})()
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
	const more =
		!expanded && batch.items.length > rows.length
			? [muted(`… ${batch.items.length - rows.length} more urls`, theme)]
			: [];
	return [title, ...rows, ...more].join("\n");
}

export function progressStartedAtMs(details: ProgressDetails): number | undefined {
	const ms = Date.parse(details.timing?.startedAt ?? "");
	return Number.isFinite(ms) ? ms : undefined;
}

export function progressPillState(state: string): StatusPillState {
	if (state === "done" || state === "error") return state;
	return state === "queued" || state === "waiting" ? "waiting" : "loading";
}

export function toolProgressCard(
	toolName: `web_${string}`,
	details: ProgressDetails,
	theme?: RenderTheme,
	options?: { allowIcons?: boolean },
): RenderComponent {
	const startedAtMs = progressStartedAtMs(details) ?? Date.now();
	return defineResultRenderer({
		renderContent(width) {
			const statusWidth = Math.max(12, Math.min(18, Math.floor(width * 0.22)));
			const state = progressPillState(details.state);
			const count = details.total ? ` ${details.current ?? 0}/${details.total}` : "";
			const message = details.message ? ` · ${details.message}` : "";
			const url = details.url ? ` · ${details.url}` : "";
			const glyph = renderStatusGlyph(state, theme);
			const pill = renderStatusPill({
				label:
					details.state === "queued"
						? "waiting"
						: details.state === "processing" || details.state === "connecting"
							? "loading"
							: details.state,
				state,
				width: statusWidth,
				theme,
				startedAtMs,
				restoreBg: "toolPendingBg",
			});
			const lines = [`${glyph} ${toolName} ${details.state}${count}${url}${message} ${pill}`];
			if (details.checklist?.length) {
				const formatter = options?.allowIcons
					? (item: { label: string; state: string; detail?: string }) =>
							`${{ done: "\u2713", failed: "\u2715", warning: "\u26A0", pending: "\u2610" }[item.state] ?? "\u2022"} ${formatChecklistText(item)}`
					: formatChecklistText;
				lines.push(...details.checklist.map(formatter));
			}
			if (details.counts) {
				const counts = details.counts;
				const segment = (val: number | undefined, label: string, render: (v: number) => string) =>
					val === undefined ? undefined : options?.allowIcons ? render(val) : `${val} ${label}`;
				lines.push(
					[
						segment(counts.succeeded, "succeeded", (n) => c.success(n, "succeeded", theme)),
						segment(counts.failed, "failed", (n) => c.failure(n, "failed", theme)),
						segment(counts.cacheHits, "cache hits", (n) => c.activity(n, "cache hits", "ⓞ", theme)),
					]
						.filter(Boolean)
						.join(" · "),
				);
			}
			return lines.filter(Boolean).join("\n");
		},
		padToWidth: true,
	});
}

export function defineResultRenderer(options: {
	renderContent: (width: number) => string;
	mapLines?: (lines: string[], width: number) => string[];
	padToWidth?: boolean;
	markdownPreview?: (width: number) => Component | undefined;
}): RenderComponent {
	return {
		render(width: number) {
			const text = options.renderContent(width);
			let lines = renderText(text, {
				padToWidth: options.padToWidth !== false,
			}).render(width);
			if (options.mapLines) lines = options.mapLines(lines, width);
			const md = options.markdownPreview?.(width);
			return md ? [...lines, "", ...md.render(width)] : lines;
		},
		invalidate() {
			// Tool result cards are static; nothing to invalidate.
		},
	};
}

export function toolStackedCard(
	options: {
		body: string | ((width: number) => string);
		summary: string;
		expanded?: boolean;
		notice?: string;
		expandedSections?: (width: number) => Array<string | undefined>;
		markdownPreview?: (width: number) => RenderComponent | undefined;
		responseId?: string;
		padToWidth?: boolean;
		hasError?: boolean;
	},
	theme?: RenderTheme,
): RenderComponent {
	return defineResultRenderer({
		renderContent(width) {
			const body = typeof options.body === "function" ? options.body(width) : options.body;
			const lines = options.summary ? [body, "", options.summary] : [body];
			if (options.notice) lines.push("", muted(options.notice, theme));
			if (options.expanded) {
				for (const section of options.expandedSections?.(width) ?? [])
					if (section) lines.push("", section);
				if (options.responseId) lines.push("", muted(`responseId: ${options.responseId}`, theme));
			}
			return lines.join("\n");
		},
		mapLines: options.hasError
			? (lines) => paintFirstLineBg(lines, "toolErrorBg", theme)
			: undefined,
		padToWidth: options.padToWidth,
		markdownPreview: options.markdownPreview,
	});
}

export function toolResultCard(
	options: {
		renderContent?: (width: number) => string;
		body?: string | ((width: number) => string);
		summary?: string;
		expanded?: boolean;
		notice?: string;
		expandedSections?: (width: number) => Array<string | undefined>;
		markdownPreview?: (width: number) => RenderComponent | undefined;
		responseId?: string;
		padToWidth?: boolean;
	},
	theme?: RenderTheme,
): RenderComponent {
	const { renderContent, body, ...rest } = options;
	return toolStackedCard(
		{
			...rest,
			body: renderContent ?? body ?? "",
			summary: rest.summary ?? "",
		},
		theme,
	);
}
