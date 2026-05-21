import { renderText } from "./text.ts";
import { paintFg } from "./theme.ts";
/** @file Compact call-line renderer used by every Pi web tool to summarize an in-flight invocation. */
import type { RenderComponent, RenderTheme } from "./types.ts";

export function renderCallLine(
	name: string,
	parts: Array<string | undefined>,
	theme?: RenderTheme,
): RenderComponent {
	const text = `${name} ${parts.filter(Boolean).join(" ")}`.trim();
	return renderText(paintFg(theme, "accent", text));
}

export const renderSimpleCall = renderCallLine;
