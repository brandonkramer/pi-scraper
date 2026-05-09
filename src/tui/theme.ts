/**
 * @fileoverview Reusable Pi terminal UI theme text helpers.
 */
import type { RenderTheme } from "../tools/define.js";

export function inlineThemeText(
	name: string,
	text: string,
	theme?: RenderTheme,
): string | undefined {
	const themed = theme?.fg?.(name, text);
	return themed?.replaceAll("\u001B[0m", "\u001B[39m");
}

export function muted(text: string, theme?: RenderTheme): string {
	return inlineThemeText("muted", text, theme) ?? text;
}

export function accent(text: string, theme?: RenderTheme): string {
	return theme?.fg?.("accent", text) ?? text;
}

export function metadataText(text: string, theme?: RenderTheme): string {
	return theme ? neutralText(text, theme) : text;
}

export function neutralText(text: string, theme?: RenderTheme): string {
	const themed = inlineThemeText("muted", text, theme);
	if (themed) return themed;
	return `\u001B[38;2;139;145;134m${text}\u001B[39m`;
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

export function separator(theme?: RenderTheme): string {
	return `${neutralText(" · ", theme)}`;
}
