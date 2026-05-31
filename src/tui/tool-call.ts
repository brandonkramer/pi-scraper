/** @file ToolCall — header line: `toolName parts[0] · parts[1] · ...` */
import { type Component, Text, truncateToWidth } from "@earendil-works/pi-tui";

import { paintFg } from "./theme.ts";
import type { RenderComponent, RenderTheme } from "./types.ts";

export function toolCall(
	name: string,
	parts: (string | undefined)[],
	theme?: RenderTheme,
): RenderComponent {
	const label = [name, ...(parts.filter(Boolean) as string[])].join(" ");
	return renderText(paintFg(theme, "accent", label));
}

/** Width-safe text render component. */
export function renderText(text: string, options: { padToWidth?: boolean } = {}): Component {
	const component = new Text(text, 0, 0);
	return {
		render(width: number): string[] {
			const safeWidth = Math.max(1, Math.floor(width || 80));
			const rendered = component.render(safeWidth);
			const lines = rendered.length > 0 ? rendered : [""];
			return options.padToWidth
				? lines.map((line) => truncateToWidth(line, safeWidth, "", true))
				: lines.map((line) => line.replaceAll(/ +$/gu, ""));
		},

		invalidate(): void {
			component.invalidate();
		},
	};
}
