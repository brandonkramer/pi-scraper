/**
 * @fileoverview Width-safe text render components for Pi terminal UI cards.
 */
import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { RenderComponent } from "../tools/define.js";

class TextRenderComponent implements RenderComponent {
	constructor(
		private readonly text: string,
		private readonly options: { padToWidth?: boolean; truncate?: boolean } = {},
	) {}

	render(width: number): string[] {
		const safeWidth = Math.max(1, Math.floor(width || 80));
		const lines = this.text.split("\n").flatMap((line) => {
			const normalized = line.replaceAll("\t", "   ");
			return this.options.truncate
				? [truncateToWidth(normalized, safeWidth, "…")]
				: wrapTextWithAnsi(normalized, safeWidth);
		});
		return this.options.padToWidth
			? lines.map((line) => truncateToWidth(line, safeWidth, "", true))
			: lines;
	}

	invalidate(): void {
		// Static text renderers have no cached state to clear.
	}
}

export function renderText(
	text: string,
	options: { padToWidth?: boolean; truncate?: boolean } = {},
): RenderComponent {
	return new TextRenderComponent(text, options);
}
