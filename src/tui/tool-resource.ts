import { failure, muted, success, inlineThemeText } from "./theme.ts";
import { type StatusPillState, renderStatusGlyph, renderStatusPill } from "./tool-status.ts";
import type { RenderTheme } from "./types.ts";
/** @file URL status rows, badges, fetched-resource formatters, and resource status. */

function paintAccentUrl(url: string, width: number, theme?: RenderTheme): string {
	const t =
		url.length <= width
			? url.padEnd(width, " ")
			: width <= 1
				? "…"
				: `${url.slice(0, Math.ceil((width - 1) / 2))}…${url.slice(url.length - Math.floor((width - 1) / 2))}`;
	return inlineThemeText("accent", t, theme) ?? t;
}

export interface ResourceListItem {
	readonly ok: boolean;
	readonly url: string;
	readonly finalUrl?: string;
	readonly title?: string;
	readonly excerpt?: string;
	readonly fields: {
		status?: number | string;
		mode?: string;
		format?: string;
		contentType?: string;
		downloadedBytes?: number;
		durationMs?: number;
		cached?: boolean;
		staleness?: string;
		truncated?: boolean;
	};
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
	const m = options.metadata;
	const jobId = typeof m?.jobId === "string" ? m.jobId : undefined;
	const pkg = typeof m?.packageResponseId === "string" ? m.packageResponseId : undefined;
	if (jobId || pkg) {
		lines.push("", "Stored handles:");
		if (jobId) lines.push(`jobId: ${jobId}`);
		if (pkg) lines.push(`packageResponseId: ${pkg}`);
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
	const f = item.fields;
	const fieldsStr =
		[
			f.status ? `status ${f.status}` : undefined,
			f.mode,
			f.format,
			f.contentType,
			formatBytes(f.downloadedBytes),
			formatDuration(f.durationMs),
			f.cached ? `cache hit${f.staleness ? ` ${f.staleness}` : ""}` : undefined,
			f.truncated ? "truncated" : undefined,
		]
			.filter(Boolean)
			.join(" · ") || "fetched";
	const lines = [`✓ ${item.url}`, `  ${fieldsStr}`];
	if (item.finalUrl && item.finalUrl !== item.url) lines.push(`  final: ${item.finalUrl}`);
	if (item.title) lines.push(`  title: ${item.title}`);
	if (item.excerpt) lines.push(`  excerpt: ${item.excerpt}`);
	return lines;
}

export function formatBytes(bytes: number | undefined): string | undefined {
	if (typeof bytes !== "number") return;
	if (bytes < 1024) return `${bytes} B`;
	return `${(bytes / 1024).toFixed(1)} KB`;
}

export function formatDuration(ms: number | undefined): string | undefined {
	if (typeof ms !== "number") return;
	return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

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

export interface ToolResourceOptions extends Partial<
	Omit<ToolResourceStatusRow, "url" | "state" | "restoreBg">
> {
	url: string;
	state?: ToolResourceState | ToolResourceStatusState;
	badge?: string;
	detail?: string;
}

export function toolResourceStatus(row: ToolResourceStatusRow): string {
	const statusWidth = Math.max(12, Math.min(18, Math.floor(row.width * 0.22)));
	const box =
		row.statusBox ??
		renderStatusPill({
			label: row.label ?? row.state,
			state: row.state,
			width: statusWidth,
			theme: row.theme,
			startedAtMs: row.startedAtMs,
			restoreBg: row.restoreBg,
		});
	return `${renderStatusGlyph(row.state, row.theme)} ${paintAccentUrl(row.url, Math.max(12, row.width - statusWidth - 3), row.theme)} ${box}`;
}

export function toolResource(options: ToolResourceOptions): string {
	if (options.badge !== undefined && options.width !== undefined) {
		const badgeText = options.badge ? `[ ${options.badge} ]` : "";
		const urlWidth = Math.max(12, options.width - badgeText.length - 2);
		const renderedUrl = paintAccentUrl(options.url, urlWidth, options.theme);
		const badge = badgeText
			? (inlineThemeText("muted", badgeText, options.theme) ?? badgeText)
			: "";
		return badge ? `${renderedUrl} ${badge}` : renderedUrl;
	}
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
	const state = options.state ?? "pending";
	const glyph =
		state === "ok" || state === "done"
			? success("✓", options.theme)
			: state === "error"
				? failure("✕", options.theme)
				: muted("·", options.theme);
	return `${glyph} ${options.url}${options.detail ? ` ${muted(options.detail, options.theme)}` : ""}`;
}
