/**
 * @fileoverview Map result card and URL badge row rendering.
 */
import type { RenderComponent, RenderTheme } from "../tui/types.ts";
import { renderText } from "./render.ts";
import { muted } from "../tui/theme.ts";
import { renderUrlBadgeRow } from "../tui/rows.ts";
import type { MapUrlEntryView } from "./web-renderer-views.ts";

export function renderMapResultCard(
	urls: readonly MapUrlEntryView[],
	expanded: boolean,
	theme?: RenderTheme,
): RenderComponent {
	return {
		render(width: number) {
			const title = theme?.bold?.("web_map") ?? "web_map";
			const rows = urls
				.slice(0, expanded ? urls.length : 12)
				.map((entry) => renderMapRow(entry, width, theme));
			const more =
				!expanded && urls.length > rows.length
					? muted(`… ${urls.length - rows.length} more urls`, theme)
					: "";
			const lines = [title, ...rows];
			if (more) lines.push(more);
			return renderText(lines.join("\n"), { padToWidth: true }).render(width);
		},
		invalidate() {},
	};
}

function renderMapRow(
	entry: MapUrlEntryView,
	width: number,
	theme?: RenderTheme,
): string {
	return renderUrlBadgeRow({
		url: entry.url,
		badge: entry.source,
		width,
		theme,
	});
}
