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

const STATE_BG: Record<StatusPillState, string> = {
	done: "toolSuccessBg",
	error: "toolErrorBg",
	waiting: "toolPendingBg",
	loading: "toolPendingBg",
};

const GLYPHS: Record<StatusPillState, [string, string]> = {
	done: ["accent", "✓"],
	error: ["error", "✕"],
	loading: ["accent", ""],
	waiting: ["muted", "·"],
};

export function renderStatusPill(options: StatusPillOptions): string {
	const inner = centerStatusLabel(options.label, Math.max(1, options.width - 2));
	const text = `[${inner}]`;
	const theme = options.theme;
	if (!theme?.bg) return neutral(text, theme);
	const bg = STATE_BG[options.state];
	const tail = bgStart(bg, theme);
	if (options.state === "loading") return `${renderLoadingStatusFill(options, text)}${tail}`;
	const body = options.state === "waiting" ? neutral(text, theme) : text;
	return `${backgroundText(bg, body, theme)}${tail}`;
}

export function renderStatusGlyph(state: StatusPillState, theme?: RenderTheme): string {
	const [tone, glyph] = GLYPHS[state];
	const g = state === "loading" ? currentSpinnerFrame() : glyph;
	return inlineThemeText(tone, g, theme) ?? g;
}

function renderLoadingStatusFill(options: StatusPillOptions, text: string): string {
	const theme = options.theme;
	const filled = text.slice(0, Math.max(1, Math.ceil(text.length * loadingRatio(options))));
	const rest = text.slice(filled.length);
	const restPaint = rest ? backgroundText("toolPendingBg", neutral(rest, theme), theme) : "";
	return `${backgroundText("selectedBg", filled, theme)}${restPaint}`;
}

function loadingRatio(options: StatusPillOptions): number {
	if (options.state === "done") return 1;
	const started = options.startedAtMs;
	if (typeof started !== "number") return 0.1;
	const elapsed = Date.now() - started;
	return elapsed >= 2400 ? 0.6 : elapsed >= 1600 ? 0.4 : elapsed >= 800 ? 0.2 : 0.1;
}

function centerStatusLabel(label: string, width: number): string {
	const base = ` ${label} `;
	if (base.length >= width) return base.slice(0, width);
	return `${" ".repeat(Math.floor((width - base.length) / 2))}${base}`.padEnd(width, " ");
}
