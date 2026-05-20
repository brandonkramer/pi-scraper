/**
 * @file Pi web_scrape tool result and progress card renderers, including the URL result card
 *   composition.
 */
import { Markdown } from "@earendil-works/pi-tui";

import { formatChecklistText } from "../../tui/checklist.ts";
import { freshnessLabel, sessionNotice } from "../../tui/envelope.ts";
import { isFileResult, renderFileResultCard } from "../../tui/file.ts";
import { formatBytes, formatDuration } from "../../tui/format.ts";
import { formatPreview, previewText } from "../../tui/preview.ts";
import { progressStartedAtMs } from "../../tui/progress.ts";
import { renderUrlStatusRow } from "../../tui/rows.ts";
import { currentSpinnerFrame } from "../../tui/spinner.ts";
import { renderStackedResultCard } from "../../tui/stacked.ts";
import { renderText } from "../../tui/text.ts";
import {
	getMarkdownTheme,
	muted,
	neutral,
	separator,
	success,
	failure,
	activity,
} from "../../tui/theme.ts";
import { renderTreeSections } from "../../tui/tree.ts";
import type { RenderComponent, RenderTheme } from "../../tui/types.ts";
import {
	isProgress,
	type PiToolShell,
	type ProgressDetails,
	type ResultEnvelope,
} from "../../types.ts";

export function renderWebScrapeResult(
	result: PiToolShell,
	expanded = false,
	theme?: RenderTheme,
): RenderComponent {
	const details = result.details as Partial<ResultEnvelope<unknown>> | ProgressDetails;
	if (isProgress(details)) return renderScrapeProgressCard(details, expanded, theme);
	const envelope = details as Partial<ResultEnvelope<Record<string, unknown>>>;

	const isCached = envelope.cache?.cached;
	const sourceLabel = isCached
		? activity(
				`\u21BB cache hit${envelope.cache?.staleness ? ` ${envelope.cache.staleness}` : ""}`,
				theme,
			)
		: success("\u21BB fresh fetch", theme);

	const summary = envelope.error
		? [`${envelope.mode ?? ""} mode`, envelope.format ?? ""]
				.filter(Boolean)
				.join(theme ? separator(theme) : " · ")
		: [
				`${statusDot(envelope.status, theme)} ${envelope.status ?? ""}`,
				`${envelope.mode ?? ""} mode`,
				envelope.format,
				sourceLabel,
				muted(formatDuration(envelope.timing?.durationMs) ?? "", theme),
				freshnessLabel(envelope),
				expanded ? undefined : muted("(ctrl+o to expand)", theme),
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

function statusDot(status: number | undefined, theme?: RenderTheme): string {
	if (status === undefined) return "\u25CF";
	if (status < 300) return success("\u25CF", theme);
	if (status < 400) return neutral("\u25CF", theme);
	return failure("\u25CF", theme);
}

function renderScrapeProgressCard(
	details: ProgressDetails,
	expanded: boolean,
	theme?: RenderTheme,
): RenderComponent {
	const url = details.url ?? "unknown URL";
	const failed = details.state === "error";
	const status = failed ? "error" : details.state === "done" ? "done" : "loading";
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
			}${muted("(ctrl+o to expand)", theme)}`;
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
		invalidate() {
			/* no-op */
		},
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
			body: (width) => renderScrapeRow(url, Boolean(envelope.error), width, theme),
			summary: options.summary,
			expanded: options.expanded,
			notice: options.notice,
			expandedSections: (width) => scrapeExpandedSections(envelope, options, width, theme),
			markdownPreview: (_width) =>
				markdownPreviewComponent(envelope.format, options.preview, theme),
			responseId: options.responseId,
		},
		theme,
	);
}

function renderScrapeRow(url: string, failed: boolean, width: number, theme?: RenderTheme): string {
	const state = failed ? "error" : "done";
	return renderUrlStatusRow({
		url,
		label: state,
		state,
		width,
		theme,
	});
}

function markdownPreviewComponent(
	format: string | undefined,
	preview: string | undefined,
	theme?: RenderTheme,
): RenderComponent | undefined {
	if (format !== "markdown" || !preview || preview.length <= 100) return;
	return new Markdown(preview.slice(0, 1200), 0, 0, getMarkdownTheme(theme));
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
	const sections: string[] = [];

	// Always build the full tree: header-derived sections + scrape details + errors
	const allSections = buildScrapeDetailsSections(envelope, theme);
	const headers = envelope.headers;
	if (headers && Object.keys(headers).length > 0) {
		// Prepend page section (richer: includes site) before details
		const headerSections = buildHeaderSections(envelope, headers);
		const pageSec = headerSections.find((s) => s.name === "page");
		const other = headerSections.filter((s) => s.name !== "page");
		if (pageSec) allSections.unshift(pageSec);
		allSections.push(...other);
	}

	sections.push(renderTreeSections(allSections, width, theme));

	if (options.preview && !markdownPreviewComponent(envelope.format, options.preview, theme))
		sections.push(formatPreview(envelope.format, options.preview).slice(0, 1200));
	return sections;
}

/* --- header boxes --- */

function buildHeaderSections(
	envelope: Partial<ResultEnvelope<Record<string, unknown>>>,
	headers: Record<string, string>,
): Array<{ name: string; rows: Array<{ key: string; value: string }> }> {
	interface SectionRow {
		key: string;
		value: string;
	}
	const sections: Array<{ name: string; rows: SectionRow[] }> = [];

	const addRow = (secName: string, key: string, value: string) => {
		let sec = sections.find((s) => s.name === secName);
		if (!sec) {
			sec = { name: secName, rows: [] };
			sections.push(sec);
		}
		sec.rows.push({ key, value });
	};

	/* page */
	const title =
		typeof envelope.data?.title === "string" && envelope.data.title
			? envelope.data.title
			: undefined;
	const url = envelope.finalUrl ?? envelope.url;
	const description =
		typeof envelope.data?.description === "string" && envelope.data.description
			? envelope.data.description
			: undefined;
	if (title) addRow("page", "title", title);
	if (url) {
		try {
			addRow("page", "site", new URL(url).hostname.replace(/^www\./iu, ""));
		} catch {
			/* ignore */
		}
	}
	if (description) addRow("page", "description", description);

	/* cache */
	if (headers["cf-cache-status"]) addRow("cache", "status", headers["cf-cache-status"]);
	if (headers["age"]) {
		const sec = parseAgeSeconds(headers["age"]);
		addRow("cache", "age", sec !== undefined ? formatSeconds(sec) : headers["age"]);
	}
	const cc = parseCacheControl(headers["cache-control"]);
	const cdnCc = parseCacheControl(headers["cdn-cache-control"]);
	if (cdnCc) {
		let v = `max-age ${formatSeconds(cdnCc.maxAge)}`;
		if (cdnCc.swr) v += `  +swr ${formatSeconds(cdnCc.swr)}`;
		addRow("cache", "cdn", v);
	} else if (cc) {
		let v = `max-age ${formatSeconds(cc.maxAge)}`;
		if (cc.swr) v += `  +swr ${formatSeconds(cc.swr)}`;
		addRow("cache", "cdn", v);
	}
	if (cc?.maxAge !== undefined && (!cdnCc || cdnCc.maxAge !== cc.maxAge)) {
		let v = `max-age ${formatSeconds(cc.maxAge)}`;
		if (cc.swr && (!cdnCc || cdnCc.swr !== cc.swr)) v += `  +swr ${formatSeconds(cc.swr)}`;
		addRow("cache", "browser", v);
	}

	/* server */
	if (headers["server"]) addRow("server", "vendor", headers["server"]);
	if (headers["cf-ray"]) {
		const di = headers["cf-ray"].lastIndexOf("-");
		const ray = di !== -1 ? headers["cf-ray"].slice(0, di) : headers["cf-ray"];
		const loc = di !== -1 ? headers["cf-ray"].slice(di + 1) : "";
		addRow("server", "ray", `${ray}${loc ? `  \u2192  ${loc}` : ""}`);
	}

	/* time */
	if (headers["date"]) addRow("time", "fetched", formatHttpTime(headers["date"]));
	if (headers["last-modified"]) {
		let mv = formatHttpTime(headers["last-modified"]);
		const modMs = new Date(headers["last-modified"]).getTime();
		const nowMs = new Date(headers["date"] ?? Date.now()).getTime();
		const diffSec = Math.floor((nowMs - modMs) / 1000);
		if (diffSec > 0) mv += `  (${formatSeconds(diffSec)} ago)`;
		addRow("time", "modified", mv);
	}

	/* raw headers */
	const headerEntries: Array<[string, string]> = Object.entries(headers).filter(
		(entry): entry is [string, string] => typeof entry[1] === "string",
	);
	for (const [k, v] of headerEntries) {
		const truncated = v.length > 120 ? `${v.slice(0, 120)}...` : v;
		addRow("headers", `${k}:`, truncated);
	}

	/* trace */
	const respId = envelope.responseId ?? "";
	if (respId || headerEntries.length > 0) {
		if (respId) {
			const shortId = respId.length >= 8 ? respId.slice(0, 8) : respId;
			addRow("trace", "response", shortId);
		}
		addRow("trace", "headers", `${headerEntries.length} total`);
	}

	return sections;
}

function parseAgeSeconds(value: string | undefined): number | undefined {
	if (value === undefined) return;
	const n = Number(value);
	return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function formatSeconds(totalSeconds: number): string {
	const MIN = 60;
	const HOUR = 60 * MIN;
	const DAY = 24 * HOUR;
	if (totalSeconds < MIN) return `${totalSeconds}s`;
	if (totalSeconds < HOUR) {
		const m = Math.floor(totalSeconds / MIN);
		const s = totalSeconds % MIN;
		return s > 0 ? `${m}m ${s}s` : `${m}m`;
	}
	if (totalSeconds < DAY) {
		const h = Math.floor(totalSeconds / HOUR);
		const m = Math.floor((totalSeconds % HOUR) / MIN);
		return m > 0 ? `${h}h ${m}m` : `${h}h`;
	}
	const d = Math.floor(totalSeconds / DAY);
	const h = Math.floor((totalSeconds % DAY) / HOUR);
	return h > 0 ? `${d}d ${h}h` : `${d}d`;
}

interface CacheControlInfo {
	maxAge: number;
	swr: number | undefined;
}

function parseCacheControl(value: string | undefined): CacheControlInfo | undefined {
	if (!value) return;
	let maxAge: number | undefined;
	let swr: number | undefined;
	for (const part of value.toLowerCase().split(",")) {
		const t = part.trim();
		if (t.startsWith("max-age=")) {
			const n = Number(t.slice(8));
			if (Number.isFinite(n)) maxAge = n;
		} else if (t.startsWith("s-maxage=")) {
			const n = Number(t.slice(9));
			if (Number.isFinite(n)) maxAge = n;
		} else if (t.startsWith("stale-while-revalidate=")) {
			const n = Number(t.slice(24));
			if (Number.isFinite(n)) swr = n;
		}
	}
	return maxAge !== undefined ? { maxAge, swr } : undefined;
}

function formatHttpTime(dateStr: string): string {
	try {
		const d = new Date(dateStr);
		if (Number.isNaN(d.getTime())) return dateStr;
		const hh = d.getUTCHours().toString().padStart(2, "0");
		const mm = d.getUTCMinutes().toString().padStart(2, "0");
		const ss = d.getUTCSeconds().toString().padStart(2, "0");
		return `${hh}:${mm}:${ss} GMT`;
	} catch {
		return dateStr;
	}
}

function buildScrapeDetailsSections(
	envelope: Partial<ResultEnvelope<Record<string, unknown>>>,
	theme?: RenderTheme,
): Array<{ name: string; rows: Array<{ key: string; value: string }> }> {
	const sections: Array<{
		name: string;
		rows: Array<{ key: string; value: string }>;
	}> = [];

	const addRow = (secName: string, key: string, value: string) => {
		let sec = sections.find((s) => s.name === secName);
		if (!sec) {
			sec = { name: secName, rows: [] };
			sections.push(sec);
		}
		sec.rows.push({ key, value });
	};

	/* page */
	const title =
		typeof envelope.data?.title === "string" && envelope.data.title
			? envelope.data.title
			: undefined;
	const description =
		typeof envelope.data?.description === "string" && envelope.data.description
			? envelope.data.description
			: undefined;
	if (title) addRow("page", "title", title);
	if (description) addRow("page", "description", description);

	/* details */
	if (envelope.url) addRow("details", "url", envelope.url);
	if (envelope.finalUrl && envelope.finalUrl !== envelope.url)
		addRow("details", "final", envelope.finalUrl);
	if (envelope.status) addRow("details", "status", String(envelope.status));
	if (envelope.mode) addRow("details", "mode", envelope.mode);
	if (envelope.format) addRow("details", "format", envelope.format);
	if (envelope.downloadedBytes !== undefined)
		addRow("details", "size", formatBytes(envelope.downloadedBytes) ?? "");
	if (envelope.timing?.durationMs !== undefined)
		addRow("details", "duration", formatDuration(envelope.timing.durationMs) ?? "");
	if (envelope.contentType) addRow("details", "type", envelope.contentType);
	const source = envelope.cache?.cached ? "cache hit" : "fresh fetch";
	addRow("details", "source", source);

	/* error */
	if (envelope.error) {
		if (envelope.error.code)
			addRow("error", "code", theme ? failure(envelope.error.code, theme) : envelope.error.code);
		if (envelope.error.phase) addRow("error", "phase", envelope.error.phase);
		if (envelope.error.message) addRow("error", "message", envelope.error.message);
	}

	return sections;
}
