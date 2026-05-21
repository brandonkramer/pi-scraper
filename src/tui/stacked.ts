import { defineResultRenderer } from "./result-renderer.ts";
import { muted } from "./theme.ts";
/** @file Pi terminal UI stacked result card primitive. */
import type { RenderComponent, RenderTheme } from "./types.ts";

export interface StackedResultCardOptions {
	body: string | ((width: number) => string);
	summary: string;
	expanded?: boolean;
	notice?: string;
	expandedSections?: (width: number) => Array<string | undefined>;
	/** Optional Markdown component rendered inline after text sections when expanded. */
	markdownPreview?: (width: number) => RenderComponent | undefined;
	responseId?: string;
	padToWidth?: boolean;
}

export function renderStackedResultCard(
	options: StackedResultCardOptions,
	theme?: RenderTheme,
): RenderComponent {
	return defineResultRenderer({
		renderContent(width) {
			const body = typeof options.body === "function" ? options.body(width) : options.body;
			const lines = [body, "", options.summary];
			if (options.notice) lines.push("", muted(options.notice, theme));
			if (options.expanded) {
				const sections = options.expandedSections?.(width) ?? [];
				for (const section of sections) {
					if (section) lines.push("", section);
				}
				if (options.responseId) lines.push("", muted(`responseId: ${options.responseId}`, theme));
			}
			return lines.join("\n");
		},
		padToWidth: options.padToWidth,
		markdownPreview: options.markdownPreview,
	});
}
