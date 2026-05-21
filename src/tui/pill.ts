/**
 * @file Pi terminal UI status pill primitive with tuned background behavior. The background reset
 *   stripping is intentionally conservative to avoid trailing dark cells after `]` and background
 *   bleed past the pill boundary.
 */
import { currentSpinnerFrame } from "./spinner.ts";
import { backgroundText, inlineThemeText, neutral } from "./theme.ts";
import type { RenderTheme } from "./types.ts";

/* Background helpers — open and paint a single-line bg without trailing reset bleed. */
function bgStart(name: string, theme?: RenderTheme): string {
	const reset = "\u001B[49m";
	try {
		const value = theme?.bg?.(name, "") ?? "";
		return value.endsWith(reset) ? value.slice(0, -reset.length) : value;
	} catch {
		return "";
	}
}

function paintBgLine(line: string, bgName: string, theme?: RenderTheme): string {
	return theme?.bg ? `${backgroundText(bgName, line, theme)}${bgStart(bgName, theme)}` : line;
}

export function paintFirstLineBg(lines: string[], bgName: string, theme?: RenderTheme): string[] {
	if (lines.length === 0 || !theme?.bg) return lines;
	return lines.map((line, index) => (index === 0 ? paintBgLine(line, bgName, theme) : line));
}

export type StatusPillState = "waiting" | "loading" | "done" | "error";

export interface StatusPillOptions {
	label: string;
	state: StatusPillState;
	width: number;
	theme?: RenderTheme;
	startedAtMs?: number;
}

export function renderStatusPill(options: StatusPillOptions): string {
	const inner = centerStatusLabel(options.label, Math.max(1, options.width - 2));
	const text = `[${inner}]`;
	const theme = options.theme;
	if (!theme?.bg) return neutral(text, theme);
	const tail = bgStart(tailBg(options.state), theme);
	if (options.state === "done") return `${backgroundText("toolSuccessBg", text, theme)}${tail}`;
	if (options.state === "error") return `${backgroundText("toolErrorBg", text, theme)}${tail}`;
	if (options.state === "loading") return `${renderLoadingStatusFill(options, text)}${tail}`;
	return `${backgroundText("toolPendingBg", neutral(text, theme), theme)}${tail}`;
}

export function renderStatusGlyph(state: StatusPillState, theme?: RenderTheme): string {
	if (state === "done") return inlineThemeText("accent", "✓", theme) ?? "✓";
	if (state === "error") return inlineThemeText("error", "✕", theme) ?? "✕";
	if (state === "loading") {
		const frame = currentSpinnerFrame();
		return inlineThemeText("accent", frame, theme) ?? frame;
	}
	return inlineThemeText("muted", "·", theme) ?? "·";
}

function renderLoadingStatusFill(options: StatusPillOptions, text: string): string {
	const theme = options.theme;
	const filledWidth = Math.max(1, Math.ceil(text.length * loadingRatio(options)));
	const filled = text.slice(0, filledWidth);
	const rest = text.slice(filledWidth);
	return `${backgroundText("selectedBg", filled, theme)}${
		rest ? backgroundText("toolPendingBg", neutral(rest, theme), theme) : ""
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

function tailBg(state: StatusPillState): string {
	if (state === "done") return "toolSuccessBg";
	if (state === "error") return "toolErrorBg";
	return "toolPendingBg";
}
