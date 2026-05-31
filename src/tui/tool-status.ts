import {
	backgroundText,
	inlineThemeText,
	activity,
	neutral,
	success,
	failure,
	muted,
	separator,
} from "./theme.ts";
import type { RenderTheme } from "./types.ts";
/**
 * @file Pi terminal UI status pill primitive with tuned background behavior. The background reset
 *   stripping is intentionally conservative to avoid trailing dark cells after `]` and background
 *   bleed past the pill boundary.
 */

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

export function paintFirstLineBg(lines: string[], bgName: string, theme?: RenderTheme): string[] {
	if (lines.length === 0 || !theme?.bg) return lines;
	return lines.map((line, index) =>
		index === 0 ? `${backgroundText(bgName, line, theme)}${bgStart(bgName, theme)}` : line,
	);
}

export type StatusPillState = "waiting" | "loading" | "done" | "error";

export interface StatusPillOptions {
	label: string;
	state: StatusPillState;
	width: number;
	theme?: RenderTheme;
	startedAtMs?: number;
	/** Re-open the surrounding Box background after the pill so pill bg does not bleed across the row. */
	restoreBg?: string;
}

const STATE_BG: Record<StatusPillState, string> = {
	done: "toolSuccessBg",
	error: "toolErrorBg",
	waiting: "toolPendingBg",
	loading: "toolPendingBg",
};

export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function currentSpinnerFrame(): string {
	const tick = Math.floor(Date.now() / 80);
	return SPINNER_FRAMES[tick % SPINNER_FRAMES.length];
}

const GLYPHS: Record<StatusPillState, [string, string]> = {
	done: ["accent", "✓"],
	error: ["error", "✕"],
	loading: ["accent", ""],
	waiting: ["muted", "·"],
};

export function renderStatusPill(options: StatusPillOptions): string {
	const cw = Math.max(1, options.width - 2);
	const labelBase = ` ${options.label} `;
	const inner =
		labelBase.length >= cw
			? labelBase.slice(0, cw)
			: `${" ".repeat(Math.floor((cw - labelBase.length) / 2))}${labelBase}`.padEnd(cw, " ");
	const text = `[${inner}]`;
	const theme = options.theme;
	if (!theme?.bg) return neutral(text, theme);
	const bg = STATE_BG[options.state];
	const tail = bgStart(options.restoreBg ?? bg, theme);
	if (options.state === "loading") {
		const lrElapsed =
			typeof options.startedAtMs === "number" ? Date.now() - options.startedAtMs : 0;
		const lrRatio =
			typeof options.startedAtMs !== "number"
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
		const restPaint = rest
			? backgroundText("toolPendingBg", neutral(rest, options.theme), options.theme)
			: "";
		return `${backgroundText("selectedBg", filled, options.theme)}${restPaint}${tail}`;
	}
	const body = options.state === "waiting" ? neutral(text, theme) : text;
	return `${backgroundText(bg, body, theme)}${tail}`;
}

export function renderStatusGlyph(state: StatusPillState, theme?: RenderTheme): string {
	const [tone, glyph] = GLYPHS[state];
	const g = state === "loading" ? currentSpinnerFrame() : glyph;
	return inlineThemeText(tone, g, theme) ?? g;
}
/** @file Pi terminal UI count segment primitives for success/failure/activity. */

export function successCountSegment(count: number, label: string, theme?: RenderTheme): string {
	const text = `${count} ${label}`;
	if (count <= 0) return neutral(text, theme);
	return success(`✓ ${text}`, theme);
}

export function failureCountSegment(count: number, label: string, theme?: RenderTheme): string {
	return failure(`✕ ${count} ${label}`, theme);
}

export function activityCountSegment(
	count: number,
	label: string,
	icon: string,
	theme?: RenderTheme,
): string {
	return activity(`${icon} ${count} ${label}`, theme);
}

/**
 * @file ToolStatus — status summary line with dots and separators. Single dot variant: `● 200 ·
 *   fast mode · markdown · ↻ fresh fetch · 67 ms` Batch tally variant: `✓ 3 succeeded · ✕ 0 failed
 *   · ↻ 0 cache hits`
 */

export interface ToolStatusPart {
	text: string;
	tone?: "accent" | "success" | "failure" | "muted" | "neutral";
}

/**
 * Compose a single status line from parts. Empty/undefined parts dropped. `parts` either strings
 * (default tone) or `{text, tone}` for explicit coloring.
 */
export function toolStatus(
	parts: Array<string | ToolStatusPart | undefined | false>,
	theme?: RenderTheme,
): string {
	const rendered = parts
		.map((p) => {
			if (!p) return "";
			if (typeof p === "string") return p;
			return paintPart(p, theme);
		})
		.filter(Boolean);
	return rendered.join(separator(theme));
}

/** Status dot (●) colored by HTTP status code. */
export function toolStatusDot(status: number | undefined, theme?: RenderTheme): string {
	if (status === undefined) return "\u25CF";
	const fn = status < 300 ? success : status < 400 ? neutral : failure;
	return fn("\u25CF", theme);
}

/**
 * Batch tally segment — colored count + label with glyph prefix.
 *
 * TallyMark("success", 3, "succeeded") => `✓ 3 succeeded` (green) toolStatusMark("failure", 0,
 * "failed") => `✕ 0 failed` (red) toolStatusMark("cache", 0, "cache hits") => `↻ 0 cache hits`
 * (activity)
 */
export function toolStatusMark(
	kind: "success" | "failure" | "cache",
	count: number,
	label: string,
	theme?: RenderTheme,
): string {
	if (kind === "success") return successCountSegment(count, label, theme);
	if (kind === "failure") return failureCountSegment(count, label, theme);
	return activityCountSegment(count, label, "\u21BB", theme);
}

const TONE_FNS = {
	success,
	failure,
	muted,
	neutral,
} as const;

function paintPart(part: ToolStatusPart, theme?: RenderTheme): string {
	const fn = part.tone && part.tone !== "accent" ? TONE_FNS[part.tone] : undefined;
	return fn ? fn(part.text, theme) : part.text;
}
