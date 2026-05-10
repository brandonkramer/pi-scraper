/**
 * @fileoverview Width-safe text render components for Pi terminal UI cards.
 */
import {
	type Component,
	truncateToWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

export function renderText(
	text: string,
	options: { padToWidth?: boolean; truncate?: boolean } = {},
): Component {
	return {
		render(width: number): string[] {
			const safeWidth = Math.max(1, Math.floor(width || 80));
			const lines = text.split("\n").flatMap((line) => {
				const normalized = line.replaceAll("\t", "   ");
				return options.truncate
					? [truncateToWidth(normalized, safeWidth, "…")]
					: wrapTextWithAnsi(normalized, safeWidth);
			});
			return options.padToWidth
				? lines.map((line) => truncateToWidth(line, safeWidth, "", true))
				: lines;
		},

		invalidate(): void {
			// Static text renderers have no cached state to clear.
		},
	};
}
