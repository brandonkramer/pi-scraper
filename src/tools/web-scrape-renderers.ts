/**
 * @fileoverview Pi web_scrape tool result and progress card renderers, including the URL result card composition.
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
import {
	cacheLabel,
	errorTitle,
	freshnessLabel,
	sessionNotice,
} from "../tui/envelope-labels.ts";
import { renderStackedResultCard } from "../tui/cards.ts";
import { formatPreview, renderMetadataLines } from "../tui/preview.ts";
import { isFileResult, renderFileResultCard } from "../tui/file-result-card.ts";
import { formatBytes, formatDuration } from "../tui/format.ts";

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

function renderScrapeResultCard(
	envelope: Partial<ResultEnvelope<Record<string, unknown>>>,
	options: {
		expanded: boolean;
		summary: string;
		notice?: string;
		preview?: string;
		responseId?: string;
	},
	theme?: RenderTheme,
): RenderComponent {
	const url = envelope.finalUrl ?? envelope.url ?? "unknown URL";
	return renderStackedResultCard(
		{
			body: (width) =>
				renderScrapeRow(url, Boolean(envelope.error), width, theme),
			summary: options.summary,
			expanded: options.expanded,
			notice: options.notice,
			expandedSections: (width) =>
				scrapeExpandedSections(envelope, options, width, theme),
			responseId: options.responseId,
		},
		theme,
	);
}

function renderScrapeRow(
	url: string,
	failed: boolean,
	width: number,
	theme?: RenderTheme,
): string {
	const state = failed ? "error" : "done";
	return renderUrlStatusRow({
		url,
		label: state,
		state,
		width,
		theme,
	});
}

function scrapeExpandedSections(
	envelope: Partial<ResultEnvelope<Record<string, unknown>>>,
	options: { preview?: string },
	width: number,
	theme?: RenderTheme,
): string[] {
	if (isFileResult(envelope)) {
		return [renderFileResultCard(envelope, theme).render(width).join("\n")];
	}
	const sections = [scrapeExpandedDetails(envelope)];
	const meta = renderMetadataLines(envelope.data, theme);
	if (meta) sections.push(meta);
	if (options.preview)
		sections.push(
			formatPreview(envelope.format, options.preview).slice(0, 1200),
		);
	return sections;
}

function scrapeExpandedDetails(
	envelope: Partial<ResultEnvelope<Record<string, unknown>>>,
): string {
	const lines = ["Scrape details:"];
	const fields = [
		envelope.status ? `status ${envelope.status}` : undefined,
		envelope.mode,
		envelope.format,
		envelope.contentType,
		formatBytes(envelope.downloadedBytes),
		formatDuration(envelope.timing?.durationMs),
		envelope.cache?.cached
			? `cache hit${envelope.cache.staleness ? ` ${envelope.cache.staleness}` : ""}`
			: "fresh fetch",
		envelope.truncated ? "truncated" : undefined,
	].filter(Boolean);
	lines.push(`  ${fields.join(" · ") || "fetched"}`);
	if (envelope.url) lines.push(`  url: ${envelope.url}`);
	if (envelope.finalUrl && envelope.finalUrl !== envelope.url)
		lines.push(`  final: ${envelope.finalUrl}`);
	const title = stringField(envelope.data, "title");
	if (title) lines.push(`  title: ${title}`);
	if (envelope.error) {
		lines.push(
			`  error: ${[envelope.error.code, envelope.error.phase, envelope.error.message].filter(Boolean).join(" · ")}`,
		);
	}
	return lines.join("\n");
}

function stringField(
	data: Record<string, unknown> | undefined,
	key: string,
): string | undefined {
	const value = data?.[key];
	return typeof value === "string" && value ? value : undefined;
}
