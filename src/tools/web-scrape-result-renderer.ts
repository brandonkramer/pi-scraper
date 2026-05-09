/**
 * @fileoverview Compact Pi renderer for web_scrape URL result cards.
 */
import type { ResultEnvelope } from "../types.js";
import type { RenderComponent, RenderTheme } from "./define.js";
import { renderUrlStatusRow } from "../tui/rows.js";
import { renderStackedResultCard } from "../tui/cards.js";
import { formatPreview, renderMetadataLines } from "../tui/preview.js";
import { isFileResult, renderFileResultCard } from "../tui/file-card.js";
import { formatBytes, formatDuration } from "../tui/format.js";

export function renderScrapeResultCard(
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
