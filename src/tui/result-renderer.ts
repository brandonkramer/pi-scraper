/** @file Shared Pi tool result renderer scaffold. */
import type { Component } from "@earendil-works/pi-tui";

import { renderText } from "./text.ts";
import type { RenderComponent } from "./types.ts";

export interface ResultRendererOptions {
	renderContent: (width: number) => string;
	mapLines?: (lines: string[], width: number) => string[];
	padToWidth?: boolean;
	markdownPreview?: (width: number) => Component | undefined;
}

export function defineResultRenderer(options: ResultRendererOptions): RenderComponent {
	return {
		render(width: number) {
			const text = options.renderContent(width);
			let lines = renderText(text, {
				padToWidth: options.padToWidth !== false,
			}).render(width);
			if (options.mapLines) lines = options.mapLines(lines, width);
			const md = options.markdownPreview?.(width);
			return md ? [...lines, "", ...md.render(width)] : lines;
		},
		invalidate() {
			/* Stateless adapter; child components are recreated on render. */
		},
	};
}
