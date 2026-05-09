/**
 * @fileoverview Pi terminal UI stacked result card primitive.
 */
import type { RenderComponent, RenderTheme } from "../tools/define.js";
import { muted } from "./theme.js";
import { renderText } from "./text.js";

export interface StackedResultCardOptions {
	body: string | ((width: number) => string);
	summary: string;
	expanded?: boolean;
	notice?: string;
	expandedSections?: (width: number) => Array<string | undefined>;
	responseId?: string;
	padToWidth?: boolean;
}

export function renderStackedResultCard(
	options: StackedResultCardOptions,
	theme?: RenderTheme,
): RenderComponent {
	return {
		render(width: number) {
			const body =
				typeof options.body === "function" ? options.body(width) : options.body;
			const lines = [body, "", options.summary];
			if (options.notice) lines.push("", muted(options.notice, theme));
			if (options.expanded) {
				const sections = options.expandedSections?.(width) ?? [];
				for (const section of sections) {
					if (section) lines.push("", section);
				}
				if (options.responseId)
					lines.push("", muted(`responseId: ${options.responseId}`, theme));
			}
			return renderText(lines.join("\n"), {
				padToWidth: options.padToWidth !== false,
			}).render(width);
		},
		invalidate() {},
	};
}
