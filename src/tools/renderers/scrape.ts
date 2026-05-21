/** @file Pi web_scrape result, progress card, and URL result card composition. */
import { Markdown } from "@earendil-works/pi-tui";

import { formatChecklistText } from "../../tui/checklist.ts";
import { freshnessLabel, sessionNotice } from "../../tui/envelope.ts";
import { isFileResult, renderFileResultCard } from "../../tui/file.ts";
import { formatBytes, formatDuration } from "../../tui/format.ts";
import { formatPreview, previewText } from "../../tui/preview.ts";
import { progressStartedAtMs } from "../../tui/progress.ts";
import { defineResultRenderer } from "../../tui/result-renderer.ts";
import { renderUrlStatusRow } from "../../tui/rows.ts";
import { currentSpinnerFrame } from "../../tui/spinner.ts";
import { renderStackedResultCard } from "../../tui/stacked.ts";
import {
	activity,
	failure,
	getMarkdownTheme,
	muted,
	neutral,
	separator,
	success,
} from "../../tui/theme.ts";
import {
	createTreeBuilder,
	renderTreeSections,
	type TreeBuilder,
	type TreeSection,
} from "../../tui/tree.ts";
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

	const stale = envelope.cache?.staleness;
	const sourceLabel = envelope.cache?.cached
		? activity(`\u21BB cache hit${stale ? ` ${stale}` : ""}`, theme)
		: success("\u21BB fresh fetch", theme);

	const parts: Array<string | undefined> = envelope.error
		? [`${envelope.mode ?? ""} mode`, envelope.format ?? ""]
		: [
				`${statusDot(envelope.status, theme)} ${envelope.status ?? ""}`,
				`${envelope.mode ?? ""} mode`,
				envelope.format,
				sourceLabel,
				muted(formatDuration(envelope.timing?.durationMs) ?? "", theme),
				freshnessLabel(envelope),
				expanded ? undefined : muted("(ctrl+o to expand)", theme),
			];
	const summary = parts.filter(Boolean).join(separator(theme));
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
	return (status < 300 ? success : status < 400 ? neutral : failure)("\u25CF", theme);
}

function renderScrapeProgressCard(
	details: ProgressDetails,
	expanded: boolean,
	theme?: RenderTheme,
): RenderComponent {
	const url = details.url ?? "unknown URL";
	const status =
		details.state === "error" ? "error" : details.state === "done" ? "done" : "loading";
	const startedAtMs = progressStartedAtMs(details) ?? Date.now();
	const working = status === "loading";
	return defineResultRenderer({
		renderContent(width) {
			const row = renderUrlStatusRow({
				url,
				label: status,
				state: status,
				width,
				theme,
				startedAtMs,
			});
			const summary = `web_scrape ${details.state}${separator(theme)}${muted("(ctrl+o to expand)", theme)}`;
			const lines: string[] = [row, "", summary];
			if (expanded && details.checklist?.length)
				lines.push(
					"",
					...details.checklist.map((i) =>
						formatChecklistText({ label: i.label, detail: i.detail }),
					),
				);
			if (working) lines.push("", `${currentSpinnerFrame()} Working...`);
			return lines.join("\n");
		},
		padToWidth: true,
	});
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
	const state = envelope.error ? "error" : "done";
	const md = () => markdownPreviewComponent(envelope.format, options.preview, theme);
	return renderStackedResultCard(
		{
			body: (width) => renderUrlStatusRow({ url, label: state, state, width, theme }),
			summary: options.summary,
			expanded: options.expanded,
			notice: options.notice,
			expandedSections: (width) => scrapeExpandedSections(envelope, options, width, theme),
			markdownPreview: md,
			responseId: options.responseId,
		},
		theme,
	);
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
	const allSections = buildScrapeSections(envelope, theme);
	const out = [renderTreeSections(allSections, width, theme)];
	if (options.preview && !markdownPreviewComponent(envelope.format, options.preview, theme))
		out.push(formatPreview(envelope.format, options.preview).slice(0, 1200));
	return out;
}

function buildScrapeSections(
	envelope: Partial<ResultEnvelope<Record<string, unknown>>>,
	theme?: RenderTheme,
): TreeSection[] {
	const headers = envelope.headers;
	const hasHeaders = !!headers && Object.keys(headers).length > 0;
	const b = createTreeBuilder();
	const dataTitle =
		typeof envelope.data?.title === "string" ? envelope.data.title || undefined : undefined;
	const dataDesc =
		typeof envelope.data?.description === "string"
			? envelope.data.description || undefined
			: undefined;

	b.add("page", "title", dataTitle);
	if (hasHeaders) {
		const url = envelope.finalUrl ?? envelope.url;
		if (url) {
			try {
				b.add("page", "site", new URL(url).hostname.replace(/^www\./iu, ""));
			} catch {
				/* ignore */
			}
		}
	}
	b.add("page", "description", dataDesc);

	/* details */
	b.add("details", "url", envelope.url);
	if (envelope.finalUrl && envelope.finalUrl !== envelope.url)
		b.add("details", "final", envelope.finalUrl);
	b.add("details", "status", envelope.status ? String(envelope.status) : undefined);
	b.add("details", "mode", envelope.mode);
	b.add("details", "format", envelope.format);
	if (envelope.downloadedBytes !== undefined)
		b.add("details", "size", formatBytes(envelope.downloadedBytes) ?? "");
	if (envelope.timing?.durationMs !== undefined)
		b.add("details", "duration", formatDuration(envelope.timing.durationMs) ?? "");
	b.add("details", "type", envelope.contentType);
	b.add("details", "source", envelope.cache?.cached ? "cache hit" : "fresh fetch");

	if (envelope.error) {
		const code = envelope.error.code;
		b.add("error", "code", code ? (theme ? failure(code, theme) : code) : undefined);
		b.add("error", "phase", envelope.error.phase);
		b.add("error", "message", envelope.error.message);
	}

	if (hasHeaders) addHeaderSections(b, envelope, headers);
	return b.sections;
}

function addHeaderSections(
	b: TreeBuilder,
	envelope: Partial<ResultEnvelope<Record<string, unknown>>>,
	headers: Record<string, string>,
): void {
	/* cache */
	b.add("cache", "status", headers["cf-cache-status"]);
	if (headers["age"]) {
		const sec = parseAgeSeconds(headers["age"]);
		b.add("cache", "age", sec !== undefined ? formatSeconds(sec) : headers["age"]);
	}
	const cc = parseCacheControl(headers["cache-control"]);
	const cdnCc = parseCacheControl(headers["cdn-cache-control"]);
	const fmtCc = (maxAge: number, swr: number | undefined) =>
		swr
			? `max-age ${formatSeconds(maxAge)}  +swr ${formatSeconds(swr)}`
			: `max-age ${formatSeconds(maxAge)}`;
	const primary = cdnCc ?? cc;
	if (primary) b.add("cache", "cdn", fmtCc(primary.maxAge, primary.swr));
	if (cc?.maxAge !== undefined && (!cdnCc || cdnCc.maxAge !== cc.maxAge)) {
		const swr = cc.swr && (!cdnCc || cdnCc.swr !== cc.swr) ? cc.swr : undefined;
		b.add("cache", "browser", fmtCc(cc.maxAge, swr));
	}

	/* server */
	b.add("server", "vendor", headers["server"]);
	if (headers["cf-ray"]) {
		const di = headers["cf-ray"].lastIndexOf("-");
		const ray = di !== -1 ? headers["cf-ray"].slice(0, di) : headers["cf-ray"];
		const loc = di !== -1 ? headers["cf-ray"].slice(di + 1) : "";
		b.add("server", "ray", `${ray}${loc ? `  \u2192  ${loc}` : ""}`);
	}

	/* time */
	if (headers["date"]) b.add("time", "fetched", formatHttpTime(headers["date"]));
	if (headers["last-modified"]) {
		const now = new Date(headers["date"] ?? Date.now()).getTime();
		const diffSec = Math.floor((now - new Date(headers["last-modified"]).getTime()) / 1000);
		const suffix = diffSec > 0 ? `  (${formatSeconds(diffSec)} ago)` : "";
		b.add("time", "modified", `${formatHttpTime(headers["last-modified"])}${suffix}`);
	}

	/* raw headers */
	const headerEntries = Object.entries(headers).filter(
		(e): e is [string, string] => typeof e[1] === "string",
	);
	for (const [k, v] of headerEntries)
		b.add("headers", `${k}:`, v.length > 120 ? `${v.slice(0, 120)}...` : v);

	/* trace */
	const respId = envelope.responseId ?? "";
	if (respId || headerEntries.length > 0) {
		if (respId) b.add("trace", "response", respId.length >= 8 ? respId.slice(0, 8) : respId);
		b.add("trace", "headers", `${headerEntries.length} total`);
	}
}

function parseAgeSeconds(v: string | undefined): number | undefined {
	const n = v === undefined ? NaN : Number(v);
	return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function formatSeconds(s: number): string {
	if (s < 60) return `${s}s`;
	if (s < 3600) {
		const m = Math.floor(s / 60);
		const r = s % 60;
		return r > 0 ? `${m}m ${r}s` : `${m}m`;
	}
	if (s < 86400) {
		const h = Math.floor(s / 3600);
		const r = Math.floor((s % 3600) / 60);
		return r > 0 ? `${h}h ${r}m` : `${h}h`;
	}
	const d = Math.floor(s / 86400);
	const h = Math.floor((s % 86400) / 3600);
	return h > 0 ? `${d}d ${h}h` : `${d}d`;
}

interface CacheControlInfo {
	maxAge: number;
	swr: number | undefined;
}

const CC_FIELDS: Array<[string, "maxAge" | "swr"]> = [
	["max-age=", "maxAge"],
	["s-maxage=", "maxAge"],
	["stale-while-revalidate=", "swr"],
];

function parseCacheControl(value: string | undefined): CacheControlInfo | undefined {
	if (!value) return;
	let maxAge: number | undefined;
	let swr: number | undefined;
	for (const part of value.toLowerCase().split(",")) {
		const t = part.trim();
		for (const [prefix, field] of CC_FIELDS) {
			if (!t.startsWith(prefix)) continue;
			const n = Number(t.slice(prefix.length));
			if (Number.isFinite(n)) {
				if (field === "maxAge") maxAge = n;
				else swr = n;
			}
		}
	}
	return maxAge !== undefined ? { maxAge, swr } : undefined;
}

const pad2 = (n: number) => n.toString().padStart(2, "0");

function formatHttpTime(s: string): string {
	const d = new Date(s);
	if (Number.isNaN(d.getTime())) return s;
	return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())} GMT`;
}
