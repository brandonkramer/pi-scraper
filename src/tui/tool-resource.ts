import { failure, muted, success, inlineThemeText } from "./theme.ts";
import {
	type StatusPillOptions,
	type StatusPillState,
	renderStatusGlyph,
	renderStatusPill,
} from "./tool-status.ts";
import type { RenderTheme } from "./types.ts";
/**
 * @file URL status row, badge row, fetched resource formatters, and
 *   toolResource/toolResourceStatus.
 */

export interface UrlStatusRowOptions extends StatusPillOptions {
	url: string;
	statusBox?: string;
}

export interface UrlBadgeRowOptions {
	url: string;
	badge?: string;
	width: number;
	theme?: RenderTheme;
}

function paintAccentUrl(url: string, width: number, theme?: RenderTheme): string {
	const t = truncateMiddle(url, width);
	return inlineThemeText("accent", t, theme) ?? t;
}

export function renderUrlBadgeRow(options: UrlBadgeRowOptions): string {
	const badgeText = options.badge ? `[ ${options.badge} ]` : "";
	const urlWidth = Math.max(12, options.width - badgeText.length - 2);
	const renderedUrl = paintAccentUrl(options.url, urlWidth, options.theme);
	const badge = badgeText ? (inlineThemeText("muted", badgeText, options.theme) ?? badgeText) : "";
	return badge ? `${renderedUrl} ${badge}` : renderedUrl;
}

export function renderUrlStatusRow(options: UrlStatusRowOptions): string {
	const statusWidth = Math.max(12, Math.min(18, Math.floor(options.width * 0.22)));
	const urlWidth = Math.max(12, options.width - statusWidth - 3);
	const glyph = renderStatusGlyph(options.state, options.theme);
	const renderedUrl = paintAccentUrl(options.url, urlWidth, options.theme);
	const box =
		options.statusBox ??
		renderStatusPill({
			label: options.label,
			state: options.state,
			width: statusWidth,
			theme: options.theme,
			startedAtMs: options.startedAtMs,
			restoreBg: options.restoreBg,
		});
	return `${glyph} ${renderedUrl} ${box}`;
}

function truncateMiddle(value: string, width: number): string {
	if (value.length <= width) return value.padEnd(width, " ");
	if (width <= 1) return "…";
	const left = Math.ceil((width - 1) / 2);
	const right = Math.floor((width - 1) / 2);
	return `${value.slice(0, left)}…${value.slice(value.length - right)}`;
}

/**
 * @file Fetched-resource field formatter and per-item list composer used by scrape, batch, and
 *   crawl detail renderers.
 */

export interface FetchedResourceFields {
	status?: number | string;
	mode?: string;
	format?: string;
	contentType?: string;
	downloadedBytes?: number;
	durationMs?: number;
	cached?: boolean;
	staleness?: string;
	truncated?: boolean;
}

export function formatResourceFields(fields: FetchedResourceFields): string {
	const parts = [
		fields.status ? `status ${fields.status}` : undefined,
		fields.mode,
		fields.format,
		fields.contentType,
		formatBytes(fields.downloadedBytes),
		formatDuration(fields.durationMs),
		fields.cached ? `cache hit${fields.staleness ? ` ${fields.staleness}` : ""}` : undefined,
		fields.truncated ? "truncated" : undefined,
	].filter(Boolean);
	return parts.join(" · ") || "fetched";
}

export interface ResourceListItem {
	readonly ok: boolean;
	readonly url: string;
	readonly finalUrl?: string;
	readonly title?: string;
	readonly excerpt?: string;
	readonly fields: FetchedResourceFields;
	readonly error?: { code?: string; phase?: string; message?: string };
}

export function renderResourceItemList(
	items: readonly ResourceListItem[],
	options: {
		header: string;
		maxItems?: number;
		metadata?: { jobId?: unknown; packageResponseId?: unknown };
	},
): string {
	const max = options.maxItems ?? 20;
	const lines = [`\u2514\u2500 ${options.header}`];
	for (const item of items.slice(0, max)) {
		lines.push(...renderResourceItemLines(item));
	}
	if (items.length > max) lines.push(`… ${items.length - max} more item(s)`);
	const jobId = typeof options.metadata?.jobId === "string" ? options.metadata.jobId : undefined;
	const packageResponseId =
		typeof options.metadata?.packageResponseId === "string"
			? options.metadata.packageResponseId
			: undefined;
	if (jobId || packageResponseId) {
		lines.push("", "Stored handles:");
		if (jobId) lines.push(`jobId: ${jobId}`);
		if (packageResponseId) lines.push(`packageResponseId: ${packageResponseId}`);
	}
	return lines.join("\n");
}

function renderResourceItemLines(item: ResourceListItem): string[] {
	if (!item.ok) {
		return [
			`✕ ${item.url || "unknown URL"}`,
			`  ${[item.error?.code, item.error?.phase, item.error?.message ?? "failed"].filter(Boolean).join(" · ")}`,
		];
	}
	const lines = [`✓ ${item.url}`, `  ${formatResourceFields(item.fields)}`];
	if (item.finalUrl && item.finalUrl !== item.url) lines.push(`  final: ${item.finalUrl}`);
	if (item.title) lines.push(`  title: ${item.title}`);
	if (item.excerpt) lines.push(`  excerpt: ${item.excerpt}`);
	return lines;
}

/** @file Pi terminal UI string formatting primitives for bytes and duration. */
export function formatBytes(bytes: number | undefined): string | undefined {
	if (typeof bytes !== "number") return;
	if (bytes < 1024) return `${bytes} B`;
	return `${(bytes / 1024).toFixed(1)} KB`;
}

export function formatDuration(ms: number | undefined): string | undefined {
	if (typeof ms !== "number") return;
	return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/**
 * @file ToolResource — single-resource row. Three flavors based on input shape:
 *   toolResource({state, url, detail?}) → `✓ https://... detail` toolResource({url, badge?, width,
 *   theme?}) → `https://... [badge]` toolResource({state, url, width, theme?, label?, startedAtMs?,
 *   statusBox?, restoreBg?}) → `✓ https://... [ done ]` (loader mode)
 */

export type ToolResourceStatusState = StatusPillState;

export type ToolResourceState = "ok" | "error" | "pending" | "loading";

export interface ToolResourceStatusRow {
	url: string;
	state: ToolResourceStatusState;
	width: number;
	theme?: RenderTheme;
	label?: string;
	startedAtMs?: number;
	statusBox?: string;
	restoreBg?: string;
}

export interface ToolResourceOptions {
	url: string;
	state?: ToolResourceState | ToolResourceStatusState;
	badge?: string;
	detail?: string;
	width?: number;
	theme?: RenderTheme;
	label?: string;
	startedAtMs?: number;
	statusBox?: string;
}

/** Per-resource loader row with status pill. */
export function toolResourceStatus(row: ToolResourceStatusRow): string {
	return renderUrlStatusRow({
		url: row.url,
		state: row.state,
		width: row.width,
		theme: row.theme,
		label: row.label ?? row.state,
		startedAtMs: row.startedAtMs,
		statusBox: row.statusBox,
		restoreBg: row.restoreBg,
	});
}

export function toolResource(options: ToolResourceOptions): string {
	// Badge mode: url + [badge]
	if (options.badge !== undefined && options.width !== undefined) {
		return renderUrlBadgeRow({
			url: options.url,
			badge: options.badge,
			width: options.width,
			theme: options.theme,
		});
	}
	// Loader mode: url + status pill
	if (
		options.width !== undefined &&
		(options.label !== undefined ||
			options.startedAtMs !== undefined ||
			options.statusBox !== undefined)
	) {
		return toolResourceStatus({
			url: options.url,
			state: (options.state ?? "done") as ToolResourceStatusState,
			width: options.width,
			theme: options.theme,
			label: options.label,
			startedAtMs: options.startedAtMs,
			statusBox: options.statusBox,
		});
	}
	// Simple glyph mode
	const state = options.state ?? "pending";
	const glyph =
		state === "ok" || state === "done"
			? success("✓", options.theme)
			: state === "error"
				? failure("✕", options.theme)
				: muted("·", options.theme);
	const tail = options.detail ? ` ${muted(options.detail, options.theme)}` : "";
	return `${glyph} ${options.url}${tail}`;
}
