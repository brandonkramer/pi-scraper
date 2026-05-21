/** @file Background paint helpers — theme bg application and trailing reset stripping. */
import type { RenderTheme } from "./types.ts";

export function backgroundText(name: string, text: string, theme?: RenderTheme): string {
	try {
		return theme?.bg?.(name, text) ?? text;
	} catch {
		return text;
	}
}

/** Background opener without trailing reset — avoids dark cells after `]` and bg bleed. */
export function backgroundStart(name: string, theme?: RenderTheme): string {
	const reset = "\u001B[49m";
	try {
		const value = theme?.bg?.(name, "") ?? "";
		return value.endsWith(reset) ? value.slice(0, -reset.length) : value;
	} catch {
		return "";
	}
}

export function paintBgLine(line: string, bgName: string, theme?: RenderTheme): string {
	return theme?.bg
		? `${backgroundText(bgName, line, theme)}${backgroundStart(bgName, theme)}`
		: line;
}

export function paintFirstLineBg(lines: string[], bgName: string, theme?: RenderTheme): string[] {
	if (lines.length === 0 || !theme?.bg) return lines;
	return lines.map((line, index) => (index === 0 ? paintBgLine(line, bgName, theme) : line));
}
