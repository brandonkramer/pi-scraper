import { currentSpinnerFrame } from "./tool-spinner.ts";
import {
	backgroundText,
	inlineThemeText,
	activity,
	success,
	failure,
	muted,
	separator,
} from "./tui.ts";
import type { RenderTheme, ThemeBackgroundName } from "./types.ts";

function bgStart(name: ThemeBackgroundName, theme?: RenderTheme): string {
	const reset = "\u001B[49m";
	try {
		const value = theme?.bg?.(name, "") ?? "";
		return value.endsWith(reset) ? value.slice(0, -reset.length) : value;
	} catch {
		return "";
	}
}

/** Paints only the first rendered line with a background for error/result emphasis. */
export function paintFirstLineBg(
	lines: string[],
	bgName: ThemeBackgroundName,
	theme?: RenderTheme,
): string[] {
	if (lines.length === 0 || !theme?.bg) return lines;
	return lines.map((line, index) =>
		index === 0 ? `${backgroundText(bgName, line, theme)}${bgStart(bgName, theme)}` : line,
	);
}

/** Shared state model for status pills and row glyphs. */
export type StatusPillState = "waiting" | "loading" | "done" | "error";

/** Standard right-side status pill width derived from the terminal width. */
export const statusPillWidth = (width: number): number =>
	Math.max(12, Math.min(18, Math.floor(width * 0.22)));

/**
 * Renders a fixed-width status pill, optionally with staged loading fill.
 *
 * Example output, with color escapes omitted:
 *
 * ```txt
 * [    loading     ]
 * [      done      ]
 * ```
 */
export function renderStatusPill(o: {
	label: string;
	state: StatusPillState;
	width: number;
	theme?: RenderTheme;
	startedAtMs?: number;
	restoreBg?: ThemeBackgroundName;
}): string {
	const cw = Math.max(1, o.width - 2);
	const labelBase = ` ${o.label} `;
	const inner =
		labelBase.length >= cw
			? labelBase.slice(0, cw)
			: `${" ".repeat(Math.floor((cw - labelBase.length) / 2))}${labelBase}`.padEnd(cw, " ");
	const text = `[${inner}]`;
	const theme = o.theme;
	if (!theme?.bg) return muted(text, theme);
	const bg =
		o.state === "done" ? "toolSuccessBg" : o.state === "error" ? "toolErrorBg" : "toolPendingBg";
	const tail = bgStart(o.restoreBg ?? bg, theme);
	if (o.state === "loading") {
		const lrElapsed = typeof o.startedAtMs === "number" ? Date.now() - o.startedAtMs : 0;
		const lrRatio =
			typeof o.startedAtMs !== "number"
				? 0.1
				: lrElapsed >= 2400
					? 0.6
					: lrElapsed >= 1600
						? 0.4
						: lrElapsed >= 800
							? 0.2
							: 0.1;
		const filled = text.slice(0, Math.max(1, Math.ceil(text.length * lrRatio)));
		const rest = text.slice(filled.length);
		return `${backgroundText("selectedBg", filled, o.theme)}${rest ? backgroundText("toolPendingBg", muted(rest, o.theme), o.theme) : ""}${tail}`;
	}
	return `${backgroundText(bg, o.state === "waiting" ? muted(text, theme) : text, theme)}${tail}`;
}

/**
 * Renders the status glyph that prefixes URL/resource rows.
 *
 * Examples: loading spinner, `✓`, `✕`, or `·`.
 */
export function renderStatusGlyph(state: StatusPillState, theme?: RenderTheme): string {
	const g =
		state === "loading"
			? currentSpinnerFrame()
			: state === "done"
				? "✓"
				: state === "error"
					? "✕"
					: "·";
	return (
		inlineThemeText(
			state === "waiting" ? "muted" : state === "error" ? "error" : "accent",
			g,
			theme,
		) ?? g
	);
}

/**
 * Pre-colored count segment builders for summaries.
 *
 * Example outputs: `✓ 2 succeeded`, `✕ 1 failed`, `↻ 1 cache hits`.
 */
export const countSegments = {
	success: (count: number, label: string, theme?: RenderTheme) =>
		count <= 0 ? muted(`${count} ${label}`, theme) : success(`✓ ${count} ${label}`, theme),
	failure: (count: number, label: string, theme?: RenderTheme) =>
		count <= 0 ? muted(`${count} ${label}`, theme) : failure(`✕ ${count} ${label}`, theme),
	activity: (count: number, label: string, icon: string, theme?: RenderTheme) =>
		count <= 0 ? muted(`${count} ${label}`, theme) : activity(`${icon} ${count} ${label}`, theme),
} as const;

/** A status segment with optional tone to be joined by `toolStatus`. */
export interface ToolStatusPart {
	text: string;
	tone?: "accent" | "success" | "failure" | "muted" | "neutral";
}

/**
 * Joins truthy status segments with the standard muted separator.
 *
 * Example output:
 *
 * ```txt
 * ✓ 2 succeeded · ✕ 1 failed · markdown
 * ```
 */
export function toolStatus(
	parts: Array<string | ToolStatusPart | undefined | false>,
	theme?: RenderTheme,
): string {
	const rendered = parts
		.map((p) => {
			if (!p) return "";
			if (typeof p === "string") return p;
			const fn = p.tone && p.tone !== "accent" ? TONE_FNS[p.tone] : undefined;
			return fn ? fn(p.text, theme) : p.text;
		})
		.filter(Boolean);
	return rendered.join(separator(theme));
}

/** Returns the status dot color for HTTP status summaries. */
export function toolStatusDot(status: number | undefined, theme?: RenderTheme): string {
	if (status === undefined) return "\u25CF";
	return (status < 300 ? success : status < 400 ? muted : failure)("\u25CF", theme);
}

const TONE_FNS = { success, failure, muted, neutral: muted } as const;
