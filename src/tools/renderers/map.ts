import { renderProgressCard } from "../../tui/progress.ts";
import { renderUrlBadgeRow } from "../../tui/rows.ts";
import { renderText } from "../../tui/text.ts";
import { muted, separator } from "../../tui/theme.ts";
import type { RenderComponent, RenderTheme } from "../../tui/types.ts";
/** @file Pi web_map renderer — top-level result/progress card and URL badge rows. */
import {
	isProgress,
	type PiToolShell,
	type ProgressDetails,
	type ResultEnvelope,
} from "../../types.ts";
export interface MapUrlEntryView {
	url: string;
	source?: string;
	title?: string;
}

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
		invalidate() {
			/* no-op */
		},
	};
}

function renderMapRow(entry: MapUrlEntryView, width: number, theme?: RenderTheme): string {
	return renderUrlBadgeRow({
		url: entry.url,
		badge: entry.source,
		width,
		theme,
	});
}

export function renderWebMapResult(
	result: PiToolShell,
	expanded = false,
	theme?: RenderTheme,
): RenderComponent {
	const details = result.details as Partial<ResultEnvelope<unknown>> | ProgressDetails;
	if (isProgress(details))
		return renderProgressCard("web_map", details, theme, {
			allowIcons: false,
		});
	const envelope = details as Partial<
		ResultEnvelope<{
			urls?: { url: string; source?: string; title?: string }[];
		}>
	>;
	const urls = Array.isArray(envelope.data?.urls) ? envelope.data.urls : [];
	const summary = [
		theme?.bold?.("web_map") ?? "web_map",
		`${urls.length} URL(s)`,
		!expanded ? muted("(ctrl+o to expand)", theme) : undefined,
	]
		.filter(Boolean)
		.join(theme ? separator(theme) : " · ");
	if (urls.length === 0) {
		return renderText(`${summary}\n\n${muted("No URLs discovered.", theme)}`, {
			padToWidth: true,
		});
	}
	return {
		render(width: number) {
			const mapCard = renderMapResultCard(urls, expanded, theme);
			const mapText = mapCard.render(width).join("\n");
			const lines = [summary, mapText];
			if (expanded && envelope.responseId)
				lines.push("", muted(`responseId: ${envelope.responseId}`, theme));
			return renderText(lines.join("\n"), { padToWidth: true }).render(width);
		},
		invalidate() {
			/* no-op */
		},
	};
}
