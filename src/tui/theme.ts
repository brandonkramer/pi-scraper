/** @file Reusable Pi terminal UI theme text helpers. */
import type { MarkdownTheme } from "@earendil-works/pi-tui";

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
	return inlineThemeText("error", text, theme) ?? inlineThemeText("danger", text, theme) ?? text;
}

export function activity(text: string, theme?: RenderTheme): string {
	return inlineThemeText("warning", text, theme) ?? inlineThemeText("accent", text, theme) ?? text;
}

export function separator(theme?: RenderTheme): string {
	return neutral(" · ", theme);
}

/**
 * Build a MarkdownTheme from the runtime Pi theme palette.
 *
 * @remarks
 *   Each MarkdownTheme slot tries a semantic color name on the host theme. If the host does not
 *   define that name, the text falls back to plain.
 */
export function getMarkdownTheme(theme?: RenderTheme): MarkdownTheme {
	const themed = (name: string) => (text: string) => theme?.fg?.(name, text) ?? text;
	return {
		heading: themed("accent"),
		link: themed("accent"),
		linkUrl: themed("muted"),
		code: themed("syntaxKeyword"),
		codeBlock: themed("syntaxKeyword"),
		codeBlockBorder: themed("muted"),
		quote: themed("muted"),
		quoteBorder: themed("muted"),
		hr: themed("muted"),
		listBullet: themed("accent"),
		bold: (text) => theme?.bold?.(text) ?? themed("accent")(text),
		italic: (text) => themed("muted")(text),
		strikethrough: (text) => themed("muted")(text),
		underline: (text) => text,
	};
}
