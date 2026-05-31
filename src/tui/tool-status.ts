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

export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function currentSpinnerFrame(): string {
	return SPINNER_FRAMES[Math.floor(Date.now() / 80) % SPINNER_FRAMES.length];
}

export function renderStatusPill(o: {
	label: string;
	state: StatusPillState;
	width: number;
	theme?: RenderTheme;
	startedAtMs?: number;
	restoreBg?: string;
}): string {
	const cw = Math.max(1, o.width - 2);
	const labelBase = ` ${o.label} `;
	const inner =
		labelBase.length >= cw
			? labelBase.slice(0, cw)
			: `${" ".repeat(Math.floor((cw - labelBase.length) / 2))}${labelBase}`.padEnd(cw, " ");
	const text = `[${inner}]`;
	const theme = o.theme;
	if (!theme?.bg) return neutral(text, theme);
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
		return `${backgroundText("selectedBg", filled, o.theme)}${rest ? backgroundText("toolPendingBg", neutral(rest, o.theme), o.theme) : ""}${tail}`;
	}
	return `${backgroundText(bg, o.state === "waiting" ? neutral(text, theme) : text, theme)}${tail}`;
}

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

export const countSegments = {
	success: (count: number, label: string, theme?: RenderTheme) =>
		count <= 0 ? neutral(`${count} ${label}`, theme) : success(`✓ ${count} ${label}`, theme),
	failure: (count: number, label: string, theme?: RenderTheme) =>
		failure(`✕ ${count} ${label}`, theme),
	activity: (count: number, label: string, icon: string, theme?: RenderTheme) =>
		activity(`${icon} ${count} ${label}`, theme),
} as const;

export interface ToolStatusPart {
	text: string;
	tone?: "accent" | "success" | "failure" | "muted" | "neutral";
}

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

export function toolStatusDot(status: number | undefined, theme?: RenderTheme): string {
	if (status === undefined) return "\u25CF";
	return (status < 300 ? success : status < 400 ? neutral : failure)("\u25CF", theme);
}

const TONE_FNS = { success, failure, muted, neutral } as const;
