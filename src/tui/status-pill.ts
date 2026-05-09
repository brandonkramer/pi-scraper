/**
 * @fileoverview Pi terminal UI status pill primitive with tuned background behavior.
 *
 * The background reset stripping is intentionally conservative to avoid trailing
 * dark cells after `]` and background bleed past the pill boundary.
 */
import type { RenderTheme } from "../tools/define.js";
import { inlineThemeText, neutralText } from "./theme.js";
import { currentSpinnerFrame } from "./spinner.js";

export type StatusPillState = "waiting" | "loading" | "done" | "error";

export interface StatusPillOptions {
	label: string;
	state: StatusPillState;
	width: number;
	theme?: RenderTheme;
	startedAtMs?: number;
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
