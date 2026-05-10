/**
 * @fileoverview Pi terminal UI URL status row primitive.
 */
import type { RenderTheme } from "./types.ts";
import { inlineThemeText } from "./theme.ts";
import {
	renderStatusGlyph,
	renderStatusPill,
	type StatusPillOptions,
} from "./pill.ts";

export interface UrlStatusRowOptions extends StatusPillOptions {
	url: string;
	statusBox?: string;
}

export interface UrlBadgeRowOptions {
	url: string;
	badge?: string;
	width: number;
	theme?: RenderTheme;
}

export function renderUrlBadgeRow(options: UrlBadgeRowOptions): string {
	const badgeText = options.badge ? `[ ${options.badge} ]` : "";
	const badgeWidth = badgeText.length;
	const urlWidth = Math.max(12, options.width - badgeWidth - 2);
	const renderedUrl =
		inlineThemeText(
			"accent",
			truncateMiddle(options.url, urlWidth),
			options.theme,
		) ?? truncateMiddle(options.url, urlWidth);
	const badge = badgeText
		? (inlineThemeText("muted", badgeText, options.theme) ?? badgeText)
		: "";
	return badge ? `${renderedUrl} ${badge}` : renderedUrl;
}

export function renderUrlStatusRow(options: UrlStatusRowOptions): string {
	const statusWidth = Math.max(
		12,
		Math.min(18, Math.floor(options.width * 0.22)),
	);
	const urlWidth = Math.max(12, options.width - statusWidth - 3);
	const glyph = renderStatusGlyph(options.state, options.theme);
	const renderedUrl =
		inlineThemeText(
			"accent",
			truncateMiddle(options.url, urlWidth),
			options.theme,
		) ?? truncateMiddle(options.url, urlWidth);
	const box =
		options.statusBox ??
		renderStatusPill({
			label: options.label,
			state: options.state,
			width: statusWidth,
			theme: options.theme,
			startedAtMs: options.startedAtMs,
		});
	return `${glyph} ${renderedUrl} ${box}`;
}

function truncateMiddle(value: string, width: number): string {
	if (value.length <= width) return value.padEnd(width, " ");
	if (width <= 1) return "…";
	const left = Math.ceil((width - 1) / 2);
	const right = Math.floor((width - 1) / 2);
	return `${value.slice(0, left)}…${value.slice(value.length - right)}`;
}
