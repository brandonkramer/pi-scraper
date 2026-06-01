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

export function paintFg(theme: RenderTheme | undefined, tone: string, text: string): string {
	if (tone === "accent") return theme?.fg?.("accent", text) ?? text;
	return inlineThemeText(tone === "danger" ? "error" : tone, text, theme) ?? text;
}

export const muted = (text: string, theme?: RenderTheme) => paintFg(theme, "muted", text);
export const accent = (text: string, theme?: RenderTheme) => paintFg(theme, "accent", text);
export const success = (text: string, theme?: RenderTheme) => paintFg(theme, "success", text);
export const failure = (text: string, theme?: RenderTheme) => paintFg(theme, "error", text);
export const separator = (theme?: RenderTheme) => muted(" · ", theme);

export function backgroundText(name: string, text: string, theme?: RenderTheme): string {
	try {
		return theme?.bg?.(name, text) ?? text;
	} catch {
		return text;
	}
}

export function activity(text: string, theme?: RenderTheme): string {
	return inlineThemeText("warning", text, theme) ?? paintFg(theme, "accent", text);
}

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
