/**
 * @fileoverview Shared rendering utilities for Pi web tool cards.
 * Used by scrape, batch, crawl, map, diff, and get_result renderers.
 */
import type {
	PiToolShell,
	ProgressDetails,
	ResultEnvelope,
	StructuredError,
} from "../types.js";
import type { RenderComponent, RenderTheme } from "./define.js";
import { renderText } from "./render.js";

export const SPINNER_FRAMES = [
	"⠋",
	"⠙",
	"⠹",
	"⠸",
	"⠼",
	"⠴",
	"⠦",
	"⠧",
	"⠇",
	"⠏",
];

export function renderSpinner(tick: number, message = "Working..."): string {
	const frame = SPINNER_FRAMES[tick % SPINNER_FRAMES.length]!;
	return `${frame} ${message}`;
}

export function currentSpinnerFrame(): string {
	const tick = Math.floor(Date.now() / 80);
	return SPINNER_FRAMES[tick % SPINNER_FRAMES.length]!;
}

export function renderProgressBar(progress: number, width = 12): string {
	const clamped = Math.max(0, Math.min(1, progress));
	const filled = Math.round(clamped * width);
	const empty = width - filled;
	return `[${"=".repeat(Math.max(0, filled - 1))}${filled > 0 ? ">" : ""}${" ".repeat(Math.max(0, empty))}]`;
}

export type StatusPillState = "waiting" | "loading" | "done" | "error";

export interface StatusPillOptions {
	label: string;
	state: StatusPillState;
	width: number;
	theme?: RenderTheme;
	startedAtMs?: number;
}

export interface UrlStatusRowOptions extends StatusPillOptions {
	url: string;
	statusBox?: string;
}

export interface StackedResultCardOptions {
	body: string | ((width: number) => string);
	summary: string;
	expanded?: boolean;
	notice?: string;
	expandedSections?: (width: number) => Array<string | undefined>;
	responseId?: string;
	padToWidth?: boolean;
}

export function renderStackedResultCard(
	options: StackedResultCardOptions,
	theme?: RenderTheme,
): RenderComponent {
	return {
		render(width: number) {
			const body =
				typeof options.body === "function" ? options.body(width) : options.body;
			const lines = [body, "", options.summary];
			if (options.notice) lines.push("", muted(options.notice, theme));
			if (options.expanded) {
				const sections = options.expandedSections?.(width) ?? [];
				for (const section of sections) {
					if (section) lines.push("", section);
				}
				if (options.responseId)
					lines.push("", muted(`responseId: ${options.responseId}`, theme));
			}
			return renderText(lines.join("\n"), {
				padToWidth: options.padToWidth !== false,
			}).render(width);
		},
		invalidate() {},
	};
}

export function renderUrlStatusRow(options: UrlStatusRowOptions): string {
	const statusWidth = Math.max(
		12,
		Math.min(18, Math.floor(options.width * 0.22)),
	);
	const urlWidth = Math.max(12, options.width - statusWidth - 3);
	const glyph = renderStatusGlyph(options.state, options.theme);
	const renderedUrl =
		inlineThemeText(
			"accent",
			truncateMiddle(options.url, urlWidth),
			options.theme,
		) ?? truncateMiddle(options.url, urlWidth);
	const box =
		options.statusBox ??
		renderStatusPill({
			label: options.label,
			state: options.state,
			width: statusWidth,
			theme: options.theme,
			startedAtMs: options.startedAtMs,
		});
	return `${glyph} ${renderedUrl} ${box}`;
}

export function renderStatusPill(options: StatusPillOptions): string {
	const inner = centerStatusLabel(
		options.label,
		Math.max(1, options.width - 2),
	);
	const text = `[${inner}]`;
	const theme = options.theme;
	if (!theme?.bg) return neutralText(text, theme);
	const tail = backgroundStart(statusTailBackground(options.state), theme);
	if (options.state === "done")
		return `${backgroundText("toolSuccessBg", text, theme)}${tail}`;
	if (options.state === "error")
		return `${backgroundText("toolErrorBg", text, theme)}${tail}`;
	if (options.state === "loading")
		return `${renderLoadingStatusFill(options, text)}${tail}`;
	return `${backgroundText("toolPendingBg", neutralText(text, theme), theme)}${tail}`;
}

export function progressStartedAtMs(
	details: ProgressDetails,
): number | undefined {
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

export function renderStatusGlyph(
	state: StatusPillState,
	theme?: RenderTheme,
): string {
	if (state === "done") return inlineThemeText("success", "✓", theme) ?? "✓";
	if (state === "error") return inlineThemeText("error", "✕", theme) ?? "✕";
	if (state === "loading") {
		const frame = currentSpinnerFrame();
		return inlineThemeText("accent", frame, theme) ?? frame;
	}
	return inlineThemeText("muted", "·", theme) ?? "·";
}

function renderLoadingStatusFill(
	options: StatusPillOptions,
	text: string,
): string {
	const theme = options.theme;
	const filledWidth = Math.max(
		1,
		Math.ceil(text.length * loadingRatio(options)),
	);
	const filled = text.slice(0, filledWidth);
	const rest = text.slice(filledWidth);
	return `${backgroundText("selectedBg", filled, theme)}${
		rest ? backgroundText("toolPendingBg", neutralText(rest, theme), theme) : ""
	}`;
}

function loadingRatio(options: StatusPillOptions): number {
	if (options.state === "done") return 1;
	const startedAt = options.startedAtMs;
	if (typeof startedAt !== "number") return 0.1;
	const elapsed = Date.now() - startedAt;
	if (elapsed >= 2400) return 0.6;
	if (elapsed >= 1600) return 0.4;
	if (elapsed >= 800) return 0.2;
	return 0.1;
}

function centerStatusLabel(label: string, width: number): string {
	const base = ` ${label} `;
	if (base.length >= width) return base.slice(0, width);
	const left = Math.floor((width - base.length) / 2);
	return `${" ".repeat(left)}${base}`.padEnd(width, " ");
}

function backgroundText(
	name: string,
	text: string,
	theme?: RenderTheme,
): string {
	try {
		return theme?.bg?.(name, text) ?? text;
	} catch {
		return text;
	}
}

function backgroundStart(name: string, theme?: RenderTheme): string {
	const reset = "\u001B[49m";
	try {
		const value = theme?.bg?.(name, "") ?? "";
		return value.endsWith(reset) ? value.slice(0, -reset.length) : value;
	} catch {
		return "";
	}
}

function statusTailBackground(state: StatusPillState): string {
	if (state === "done") return "toolSuccessBg";
	if (state === "error") return "toolErrorBg";
	return "toolPendingBg";
}

export function formatPreview(
	format: string | undefined,
	content: string,
): string {
	if (format === "json") return `\`\`\`json\n${content}\n\`\`\``;
	if (format === "html") return `\`\`\`html\n${content}\n\`\`\``;
	return content;
}

export function renderMetadataLines(
	data: Record<string, unknown> | undefined,
	theme?: RenderTheme,
): string {
	if (!data) return "";
	const fields: Array<[string, unknown]> = [
		["Title", data.title],
		["Published", data.published],
		["Author", data.author],
		["Description", data.description],
	];
	const lines = fields
		.filter(([, value]) => typeof value === "string" && value.length > 0)
		.map(([label, value]) => metadataLine(label, String(value), theme));
	return lines.join("\n");
}

function metadataLine(
	label: string,
	value: string,
	theme?: RenderTheme,
): string {
	const coloredLabel =
		theme?.fg?.("syntaxKeyword", `${label}: `) ?? `${label}: `;
	const coloredValue = theme?.fg?.("syntaxString", value) ?? value;
	return `${coloredLabel}${coloredValue}`;
}

export function isFileResult(
	envelope: Partial<ResultEnvelope<unknown>>,
): boolean {
	if (
		envelope.contentType === "application/octet-stream" ||
		envelope.contentType === "application/pdf" ||
		envelope.contentType?.startsWith("image/") === true ||
		envelope.contentType?.startsWith("audio/") === true ||
		envelope.contentType?.startsWith("video/") === true
	)
		return true;
	const data = envelope.data;
	if (data && typeof data === "object" && "fileSize" in data) return true;
	return false;
}

export function renderFileResultCard(
	envelope: Partial<ResultEnvelope<Record<string, unknown>>>,
	theme?: RenderTheme,
): RenderComponent {
	const data = envelope.data;
	const lines = [
		muted(`File size: ${data?.fileSize ?? "unknown"}`, theme),
		...(data?.mimeType ? [muted(`Mime type: ${data.mimeType}`, theme)] : []),
		muted(`File path: ${data?.filePath ?? "unknown"}`, theme),
	];
	return renderText(lines.join("\n"), { padToWidth: true });
}

export function muted(text: string, theme?: RenderTheme): string {
	return inlineThemeText("muted", text, theme) ?? text;
}

export function formatBytes(bytes: number | undefined): string | undefined {
	if (typeof bytes !== "number") return undefined;
	if (bytes < 1024) return `${bytes} B`;
	return `${(bytes / 1024).toFixed(1)} KB`;
}

export function formatDuration(ms: number | undefined): string | undefined {
	if (typeof ms !== "number") return undefined;
	return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export function truncateMiddle(value: string, width: number): string {
	if (value.length <= width) return value.padEnd(width, " ");
	if (width <= 1) return "…";
	const left = Math.ceil((width - 1) / 2);
	const right = Math.floor((width - 1) / 2);
	return `${value.slice(0, left)}…${value.slice(value.length - right)}`;
}

export function withSpinnerFooter(lines: string[], tick?: number): string {
	if (typeof tick !== "number") return lines.join("\n");
	return [...lines, "", renderSpinner(tick)].join("\n");
}

export function successCountSegment(
	count: number,
	label: string,
	theme?: RenderTheme,
): string {
	const text = `${count} ${label}`;
	if (count <= 0) return neutralText(text, theme);
	return successText(`✓ ${text}`, theme);
}

export function failureCountSegment(
	count: number,
	label: string,
	theme?: RenderTheme,
): string {
	return failureText(`✖ ${count} ${label}`, theme);
}

export function activityCountSegment(
	count: number,
	label: string,
	icon: string,
	theme?: RenderTheme,
): string {
	return activityText(`${icon}  ${count} ${label}`, theme);
}

export function successText(text: string, theme?: RenderTheme): string {
	const themed = inlineThemeText("success", text, theme);
	if (themed) return themed;
	return `\u001B[38;2;148;226;213m${text}\u001B[39m`;
}

export function failureText(text: string, theme?: RenderTheme): string {
	const themed =
		inlineThemeText("error", text, theme) ??
		inlineThemeText("danger", text, theme);
	if (themed) return themed;
	return `\u001B[38;2;239;118;122m${text}\u001B[39m`;
}

export function activityText(text: string, theme?: RenderTheme): string {
	const themed =
		inlineThemeText("warning", text, theme) ??
		inlineThemeText("accent", text, theme);
	if (themed) return themed;
	return `\u001B[38;2;199;211;111m${text}\u001B[39m`;
}

export function neutralText(text: string, theme?: RenderTheme): string {
	const themed = inlineThemeText("muted", text, theme);
	if (themed) return themed;
	return `\u001B[38;2;139;145;134m${text}\u001B[39m`;
}

export function metadataText(text: string, theme?: RenderTheme): string {
	return theme ? neutralText(text, theme) : text;
}

export function inlineThemeText(
	name: string,
	text: string,
	theme?: RenderTheme,
): string | undefined {
	const themed = theme?.fg?.(name, text);
	return themed?.replaceAll("\u001B[0m", "\u001B[39m");
}

export function separator(theme?: RenderTheme): string {
	return `${neutralText(" · ", theme)}`;
}

export function accent(text: string, theme?: RenderTheme): string {
	return theme?.fg?.("accent", text) ?? text;
}

export function isProgress(value: unknown): value is ProgressDetails {
	return Boolean(
		value &&
			typeof value === "object" &&
			"_progress" in value &&
			(value as ProgressDetails)._progress,
	);
}

export function errorTitle(
	tool: `web_${string}`,
	error: StructuredError,
): string {
	const prefix = toolAllowsIcons(tool) ? "✕ " : "";
	return `${prefix}${tool} ${error.code}: ${error.message}`;
}

function toolAllowsIcons(toolName: `web_${string}`): boolean {
	return toolName === "web_batch" || toolName === "web_crawl";
}

export function previewText(
	result: PiToolShell,
	envelope: Partial<ResultEnvelope<Record<string, unknown>>>,
): string {
	const data = envelope.data;
	return String(
		envelope.answerContext ??
			data?.markdown ??
			data?.text ??
			data?.title ??
			result.content[0]?.text ??
			"",
	);
}

export function formatChecklistItem(item: {
	label: string;
	state: string;
	detail?: string;
}): string {
	const icon =
		item.state === "done"
			? "✓"
			: item.state === "failed"
				? "✕"
				: item.state === "warning"
					? "⚠"
					: item.state === "pending"
						? "☐"
						: "•";
	return `${icon} ${item.label}${item.detail ? ` — ${item.detail}` : ""}`;
}

export function formatChecklistText(item: {
	label: string;
	detail?: string;
}): string {
	return `${item.label}${item.detail ? ` — ${item.detail}` : ""}`;
}
