/**
 * @fileoverview Reusable Pi terminal UI theme text helpers.
 */
import type { RenderTheme } from "./types.ts";

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

export function neutral(text: string, theme?: RenderTheme): string {
	return inlineThemeText("muted", text, theme) ?? text;
}

export function success(text: string, theme?: RenderTheme): string {
	return inlineThemeText("success", text, theme) ?? text;
}

export function failure(text: string, theme?: RenderTheme): string {
	return (
		inlineThemeText("error", text, theme) ??
		inlineThemeText("danger", text, theme) ??
		text
	);
}

export function activity(text: string, theme?: RenderTheme): string {
	return (
		inlineThemeText("warning", text, theme) ??
		inlineThemeText("accent", text, theme) ??
		text
	);
}

export function separator(theme?: RenderTheme): string {
	return `${neutral(" · ", theme)}`;
}
