/**
 * @fileoverview Pi web_scrape tool result and progress card renderers.
 */
import {
	isProgress,
	type PiToolShell,
	type ProgressDetails,
	type ResultEnvelope,
} from "../types.ts";
import type { RenderComponent, RenderTheme } from "../tui/types.ts";
import { renderText } from "./render.ts";
import { metadataText, separator } from "../tui/theme.ts";
import { currentSpinnerFrame } from "../tui/spinner.ts";
import { progressStartedAtMs } from "../tui/progress-status.ts";
import { renderUrlStatusRow } from "../tui/rows.ts";
import { formatChecklistText } from "../tui/checklist.ts";
import { previewText } from "../tui/preview-text.ts";
import { renderScrapeResultCard } from "./web-scrape-result-renderer.ts";
import {
	cacheLabel,
	errorTitle,
	freshnessLabel,
	sessionNotice,
} from "../tui/envelope-labels.ts";

export function renderWebScrapeResult(
	result: PiToolShell,
	expanded = false,
	theme?: RenderTheme,
): RenderComponent {
	const details = result.details as
		| Partial<ResultEnvelope<unknown>>
		| ProgressDetails;
	if (isProgress(details))
		return renderScrapeProgressCard(details, expanded, theme);
	const envelope = details as Partial<ResultEnvelope<Record<string, unknown>>>;
	const summary = envelope.error
		? errorTitle("web_scrape", envelope.error, { allowIcons: false })
		: [
				envelope.status ?? "ok",
				envelope.mode,
				envelope.format,
				cacheLabel(envelope) ?? "fresh fetch",
				freshnessLabel(envelope),
				!expanded ? metadataText("(ctrl+o to expand)", theme) : undefined,
			]
				.filter(Boolean)
				.join(theme ? separator(theme) : " · ");
	return renderScrapeResultCard(
		envelope,
		{
			expanded,
			summary,
			notice: sessionNotice(envelope),
			preview: previewText(result, envelope),
			responseId: envelope.responseId,
		},
		theme,
	);
}

function renderScrapeProgressCard(
	details: ProgressDetails,
	expanded: boolean,
	theme?: RenderTheme,
): RenderComponent {
	const url = details.url ?? "unknown URL";
	const failed = details.state === "error";
	const status = failed
		? "error"
		: details.state === "done"
			? "done"
			: "loading";
	const startedAtMs = progressStartedAtMs(details) ?? Date.now();
	return {
		render(width: number) {
			const row = renderUrlStatusRow({
				url,
				label: status,
				state: status,
				width,
				theme,
				startedAtMs,
			});
			const summary = `web_scrape ${details.state}${
				theme ? separator(theme) : " · "
			}${metadataText("(ctrl+o to expand)", theme)}`;
			const lines = [row, "", summary];
			if (expanded && details.checklist?.length) {
				lines.push(
					"",
					...details.checklist.map((item) =>
						formatChecklistText({
							label: item.label,
							detail: item.detail,
						}),
					),
				);
			}
			if (details.state !== "done" && details.state !== "error") {
				const frame = currentSpinnerFrame();
				const text = [...lines, "", `${frame} Working...`].join("\n");
				return renderText(text, { padToWidth: true }).render(width);
			}
			return renderText(lines.join("\n"), { padToWidth: true }).render(width);
		},
		invalidate() {},
	};
}
