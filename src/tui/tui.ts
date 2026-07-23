/** Core TUI text and theme helpers shared by cards and renderer adapters. */
import { type Component, type MarkdownTheme, Text, truncateToWidth } from "@earendil-works/pi-tui";

import type { RenderTheme, ThemeBackgroundName, ThemeColorName } from "./types.ts";

/**
 * Applies a foreground theme color and normalizes full resets to foreground resets.
 *
 * Example with a theme-provided wrapper:
 *
 * ```txt
 * <fg:muted>text\u001B[39m
 * ```
 */
export function inlineThemeText(
	name: ThemeColorName,
	text: string,
	theme?: RenderTheme,
): string | undefined {
	return theme?.fg?.(name, text).replaceAll("\u001B[0m", "\u001B[39m");
}

/**
 * Foreground paint helper with fallback to raw text when no theme is present.
 *
 * `danger` is normalized to the shared `error` tone.
 */
export function paintFg(
	theme: RenderTheme | undefined,
	tone: ThemeColorName | "danger",
	text: string,
): string {
	if (tone === "accent") return theme?.fg?.("accent", text) ?? text;
	return inlineThemeText(tone === "danger" ? "error" : tone, text, theme) ?? text;
}

/** Muted foreground text, e.g. secondary labels and hints. */
export const muted = (text: string, theme?: RenderTheme) => paintFg(theme, "muted", text);
/** Accent foreground text, e.g. tool names and URLs. */
export const accent = (text: string, theme?: RenderTheme) => paintFg(theme, "accent", text);
/** Success foreground text, e.g. checkmarks and 2xx status dots. */
export const success = (text: string, theme?: RenderTheme) => paintFg(theme, "success", text);
/** Error foreground text, e.g. failures and blocked rows. */
export const failure = (text: string, theme?: RenderTheme) => paintFg(theme, "error", text);
/** Standard muted segment separator used in status lines. */
export const separator = (theme?: RenderTheme) => muted(" · ", theme);

/**
 * Applies a background color while tolerating theme implementations that throw.
 *
 * Falls back to the raw text so renderer output is never blocked by theming.
 */
export function backgroundText(
	name: ThemeBackgroundName,
	text: string,
	theme?: RenderTheme,
): string {
	try {
		return theme?.bg?.(name, text) ?? text;
	} catch {
		return text;
	}
}

/** Warning/accent text used for activity counters such as cache hits. */
export function activity(text: string, theme?: RenderTheme): string {
	return inlineThemeText("warning", text, theme) ?? paintFg(theme, "accent", text);
}

/**
 * Adapts the tool render theme to the Pi Markdown component theme shape.
 *
 * Used when result previews render markdown instead of plain wrapped text.
 */
export function getMarkdownTheme(theme?: RenderTheme): MarkdownTheme {
	const themed = (name: ThemeColorName) => (text: string) => theme?.fg?.(name, text) ?? text;
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

/**
 * Wraps text that is rebuilt on each render/invalidate cycle.
 *
 * Use when spinner frames, live theme values, or progress text can change without replacing the
 * component object.
 */
export function renderDynamicText(
	buildText: () => string,
	options: { padToWidth?: boolean } = {},
): Component {
	const component = new Text(buildText(), 0, 0);
	return renderTextComponent(component, () => component.setText(buildText()), options);
}

/**
 * Wraps static text in a width-aware Pi TUI `Text` component.
 *
 * With `padToWidth`, every rendered line is truncated/padded to the terminal width.
 */
export function renderText(text: string, options: { padToWidth?: boolean } = {}): Component {
	return renderTextComponent(new Text(text, 0, 0), undefined, options);
}

function renderTextComponent(
	component: Text,
	refresh: (() => void) | undefined,
	options: { padToWidth?: boolean },
): Component {
	return {
		render(width: number): string[] {
			refresh?.();
			const safeWidth = Math.max(1, Math.floor(width || 80));
			const rendered = component.render(safeWidth);
			const lines = rendered.length > 0 ? rendered : [""];
			return options.padToWidth
				? lines.map((line) => truncateToWidth(line, safeWidth, "", true))
				: lines.map((line) => line.replaceAll(/ +$/gu, ""));
		},

		invalidate(): void {
			refresh?.();
			component.invalidate();
		},
	};
}
