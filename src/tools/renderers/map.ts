import { renderProgressCard } from "../../tui/progress.ts";
import { defineResultRenderer } from "../../tui/result-renderer.ts";
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
	return defineResultRenderer({
		renderContent(width) {
			return renderMapLines(urls, expanded, width, theme);
		},
		padToWidth: true,
	});
}

function renderMapLines(
	urls: readonly MapUrlEntryView[],
	expanded: boolean,
	width: number,
	theme?: RenderTheme,
): string {
	const rows = urls
		.slice(0, expanded ? 50 : 12)
		.map((entry) => renderUrlBadgeRow({ url: entry.url, badge: entry.source, width, theme }));
	if (urls.length > rows.length)
		rows.push(muted(`… ${urls.length - rows.length} more urls`, theme));
	return rows.join("\n");
}

export function renderWebMapResult(
	result: PiToolShell,
	expanded = false,
	theme?: RenderTheme,
): RenderComponent {
	const details = result.details as Partial<ResultEnvelope<unknown>> | ProgressDetails;
	if (isProgress(details))
		return renderProgressCard("web_map", details, theme, { allowIcons: false });
	const envelope = details as Partial<
		ResultEnvelope<{ urls?: { url: string; source?: string; title?: string }[] }>
	>;
	const urls = Array.isArray(envelope.data?.urls) ? envelope.data.urls : [];
	const summary = [
		`└─ ${urls.length} URL(s)`,
		!expanded ? muted("(ctrl+o to expand)", theme) : undefined,
	]
		.filter(Boolean)
		.join(separator(theme));
	if (urls.length === 0)
		return renderText(`${summary}\n\n${muted("No URLs discovered.", theme)}`, { padToWidth: true });
	return defineResultRenderer({
		renderContent(width) {
			const mapText = renderMapLines(urls, expanded, width, theme);
			const lines = [summary, mapText];
			if (expanded && envelope.responseId)
				lines.push("", muted(`responseId: ${envelope.responseId}`, theme));
			return lines.join("\n");
		},
		padToWidth: true,
	});
}
