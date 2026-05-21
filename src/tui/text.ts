/** @file Width-safe text render components for Pi terminal UI cards. */
import { type Component, Text, truncateToWidth } from "@earendil-works/pi-tui";

export function renderText(text: string, options: { padToWidth?: boolean } = {}): Component {
	const component = new Text(text, 0, 0);
	return {
		render(width: number): string[] {
			const safeWidth = Math.max(1, Math.floor(width || 80));
			const rendered = component.render(safeWidth);
			const lines = rendered.length > 0 ? rendered : [""];
			return options.padToWidth
				? lines.map((line) => truncateToWidth(line, safeWidth, "", true))
				: lines.map((line) => stripTextPadding(line));
		},

		invalidate(): void {
			component.invalidate();
		},
	};
}

function stripTextPadding(line: string): string {
	return line.replaceAll(/ +$/gu, "");
}
