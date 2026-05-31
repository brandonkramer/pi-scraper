import type { Component } from "@earendil-works/pi-tui";

import type {
	BatchProgressItemView,
	BatchProgressStatus,
	BatchProgressView,
} from "../batch/progress-state.ts";
import type { ProgressDetails, ToolContext } from "../types.ts";
import { muted } from "./theme.ts";
import { renderText } from "./tool-call.ts";
import { formatChecklistItem, formatChecklistText } from "./tool-labels.ts";
import { toolProcess, withSpinnerFooter } from "./tool-process.ts";
import { toolResourceStatus, formatBytes } from "./tool-resource.ts";
import { toolResultId } from "./tool-result.ts";
import {
	type StatusPillState,
	renderStatusGlyph,
	renderStatusPill,
	paintFirstLineBg,
	successCountSegment,
	failureCountSegment,
	activityCountSegment,
} from "./tool-status.ts";
import type { RenderComponent, RenderTheme } from "./types.ts";

/**
 * @file Generic file/binary content-type detection and result card. Used by any tool result whose
 *   envelope carries a non-text payload.
 */

const FILE_TYPE_PREFIXES = [
	"application/octet-stream",
	"application/pdf",
	"image/",
	"audio/",
	"video/",
];

export function isFileResult(envelope: Partial<ToolContext<unknown>>): boolean {
	const ct = envelope.contentType ?? "";
	if (FILE_TYPE_PREFIXES.some((p) => ct === p || ct.startsWith(p))) return true;
	return !!(envelope.data && typeof envelope.data === "object" && "fileSize" in envelope.data);
}

export function renderFileResultCard(
	envelope: Partial<ToolContext<Record<string, unknown>>>,
	theme?: RenderTheme,
): RenderComponent {
	const data = envelope.data;
	const fileInfo = (data?.file ?? {}) as {
		path?: string;
		downloadedBytes?: number;
		contentType?: string;
	};
	const fileSize =
		stringValue(data?.fileSize) ?? formatBytes(fileInfo.downloadedBytes) ?? "unknown";
	const filePath = stringValue(data?.filePath) ?? fileInfo.path ?? "unknown";
	const mimeType = stringValue(data?.mimeType) ?? fileInfo.contentType;
	const lines = [
		muted(`File size: ${fileSize}`, theme),
		...(mimeType ? [muted(`Mime type: ${mimeType}`, theme)] : []),
		muted(`File path: ${filePath}`, theme),
	];
	return renderText(lines.join("\n"), { padToWidth: true });
}

function stringValue(value: unknown): string | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	return JSON.stringify(value);
}

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
				? renderBatchProgressText(batch, width, expanded, theme, "toolPendingBg")
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
	const rows = batch.items
		.slice(0, expanded ? batch.items.length : 12)
		.map((item) => renderBatchRow(item, width, theme, restoreBg));
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
	restoreBg?: string,
): string {
	const statusWidth = Math.max(12, Math.min(18, Math.floor(width * 0.22)));
	const state = statusState(item.status);
	return toolResourceStatus({
		url: item.url,
		label: state,
		state,
		width,
		theme,
		startedAtMs: item.startedAtMs,
		statusBox: renderStatusBox(item, statusWidth, theme, restoreBg),
		restoreBg,
	});
}

function renderStatusBox(
	item: BatchProgressItemView,
	width: number,
	theme?: RenderTheme,
	restoreBg?: string,
): string {
	if (item.status === "processing" && typeof item.progress === "number")
		return renderProgressBar(item.progress, width - 2);
	const state = statusState(item.status);
	return renderStatusPill({
		label: state,
		state,
		width,
		theme,
		startedAtMs: item.startedAtMs,
		restoreBg,
	});
}

function statusState(status: BatchProgressStatus) {
	if (status === "queued") return "waiting";
	if (status === "processing") return "loading";
	return status;
}

/** @file Pi terminal UI progress primitives — bar, status bridge, and fallback card. */

export function renderProgressBar(progress: number, width = 12): string {
	const clamped = Math.max(0, Math.min(1, progress));
	const filled = Math.round(clamped * width);
	const empty = width - filled;
	return `[${"=".repeat(Math.max(0, filled - 1))}${filled > 0 ? ">" : ""}${" ".repeat(Math.max(0, empty))}]`;
}

export function progressStartedAtMs(details: ProgressDetails): number | undefined {
	const ms = Date.parse(details.timing?.startedAt ?? "");
	return Number.isFinite(ms) ? ms : undefined;
}

export function progressPillState(state: string): StatusPillState {
	if (state === "done" || state === "error") return state;
	return state === "queued" || state === "waiting" ? "waiting" : "loading";
}

export function progressPillLabel(state: string): string {
	if (state === "queued") return "waiting";
	return state === "processing" || state === "connecting" ? "loading" : state;
}

export function renderProgressCard(
	toolName: `web_${string}`,
	details: ProgressDetails,
	theme?: RenderTheme,
	options?: { allowIcons?: boolean },
): RenderComponent {
	const startedAtMs = progressStartedAtMs(details) ?? Date.now();
	const icons = options?.allowIcons ?? false;
	return defineResultRenderer({
		renderContent(width) {
			const statusWidth = Math.max(12, Math.min(18, Math.floor(width * 0.22)));
			const state = progressPillState(details.state);
			const count = details.total ? ` ${details.current ?? 0}/${details.total}` : "";
			const message = details.message ? ` · ${details.message}` : "";
			const url = details.url ? ` · ${details.url}` : "";
			const glyph = renderStatusGlyph(state, theme);
			const pill = renderStatusPill({
				label: progressPillLabel(details.state),
				state,
				width: statusWidth,
				theme,
				startedAtMs,
				restoreBg: "toolPendingBg",
			});
			const lines = [`${glyph} ${toolName} ${details.state}${count}${url}${message} ${pill}`];
			if (details.checklist?.length) {
				const formatter = icons ? formatChecklistItem : formatChecklistText;
				lines.push(...details.checklist.map(formatter));
			}
			if (details.counts) {
				const counts = details.counts;
				const segment = (val: number | undefined, label: string, render: (v: number) => string) =>
					val === undefined ? undefined : icons ? render(val) : `${val} ${label}`;
				lines.push(
					[
						segment(counts.succeeded, "succeeded", (n) =>
							successCountSegment(n, "succeeded", theme),
						),
						segment(counts.failed, "failed", (n) => failureCountSegment(n, "failed", theme)),
						segment(counts.cacheHits, "cache hits", (n) =>
							activityCountSegment(n, "cache hits", "ⓞ", theme),
						),
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

/** @file Shared Pi tool result renderer scaffold. */

export interface ResultRendererOptions {
	renderContent: (width: number) => string;
	mapLines?: (lines: string[], width: number) => string[];
	padToWidth?: boolean;
	markdownPreview?: (width: number) => Component | undefined;
}

export function defineResultRenderer(options: ResultRendererOptions): RenderComponent {
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
			/* Stateless adapter; child components are recreated on render. */
		},
	};
}

export const toolBatchProgressCard = renderBatchProgressCard;
export const toolBatchResultCard = renderBatchResultCard;
export const toolProgressCard = renderProgressCard;
export const toolIsFileResult = isFileResult;
export const toolFileResultCard = renderFileResultCard;

export interface StackedResultCardOptions {
	body: string | ((width: number) => string);
	summary: string;
	expanded?: boolean;
	notice?: string;
	expandedSections?: (width: number) => Array<string | undefined>;
	/** Optional Markdown component rendered inline after text sections when expanded. */
	markdownPreview?: (width: number) => RenderComponent | undefined;
	responseId?: string;
	padToWidth?: boolean;
	/** When true, paint the first line background with the error color. */
	hasError?: boolean;
}

export function renderStackedResultCard(
	options: StackedResultCardOptions,
	theme?: RenderTheme,
): RenderComponent {
	return defineResultRenderer({
		renderContent(width) {
			const body = typeof options.body === "function" ? options.body(width) : options.body;
			const lines = [body, "", options.summary];
			if (options.notice) lines.push("", muted(options.notice, theme));
			if (options.expanded) {
				const sections = options.expandedSections?.(width) ?? [];
				for (const section of sections) {
					if (section) lines.push("", section);
				}
				if (options.responseId) {
					const ids = toolResultId([{ label: "responseId", id: options.responseId }], theme);
					if (ids.length > 0) lines.push("", ...ids);
				}
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

/** ToolResultCard — adapter mapping renderContent/body to StackedResultCardOptions. */
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
	return renderStackedResultCard(
		{
			...rest,
			body: renderContent ?? body ?? "",
			summary: rest.summary ?? "",
		},
		theme,
	);
}

export const toolStackedCard = renderStackedResultCard;
