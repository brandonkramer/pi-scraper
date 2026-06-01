import { Markdown } from "@earendil-works/pi-tui";

import { isProgress, type Chunk, type PiToolShell, type ToolContext } from "../../types.ts";
import {
	activity as toolActivity,
	failure as toolFailure,
	getMarkdownTheme as toolMarkdownTheme,
	muted as toolMuted,
	separator as toolSeparator,
	success as toolSuccess,
} from "../theme.ts";
import {
	toolFileResultCard,
	toolResultCard,
	toolStackedCard,
	progressStartedAtMs as toolProgressStartedAtMs,
} from "../tool-card.ts";
import {
	toolExpandHint,
	toolFreshnessLabel,
	toolSessionNotice,
	formatChecklistText as toolChecklistText,
} from "../tool-labels.ts";
import {
	toolResourceStatus,
	formatBytes as fmtBytes,
	formatDuration as fmtDuration,
} from "../tool-resource.ts";
import { buildToolResultTree, toolResultTree, type ToolResultGroup } from "../tool-result-tree.ts";
import {
	toolStatusDot,
	toolStatus,
	currentSpinnerFrame as toolCurrentSpinnerFrame,
} from "../tool-status.ts";
import type { RenderComponent, RenderTheme } from "../types.ts";

export function renderWebScrapeResult(
	result: PiToolShell,
	expanded = false,
	theme?: RenderTheme,
): RenderComponent {
	const details = result.details as Partial<ToolContext<unknown>>;
	if (isProgress(details)) {
		const url = details.url ?? "unknown URL";
		const status =
			details.state === "error" ? "error" : details.state === "done" ? "done" : "loading";
		const startedAtMs = toolProgressStartedAtMs(details) ?? Date.now();
		return toolResultCard({
			renderContent(width) {
				const row = toolResourceStatus({
					url,
					label: status,
					state: status,
					width,
					theme,
					startedAtMs,
					restoreBg: "toolPendingBg",
				});
				const summary = `web_scrape ${details.state}${toolSeparator(theme)}${toolMuted(toolExpandHint.text, theme)}`;
				const lines = [row, "", summary];
				if (expanded && details.checklist?.length)
					lines.push("", ...details.checklist.map(toolChecklistText));
				if (status === "loading") lines.push("", `${toolCurrentSpinnerFrame()} Working...`);
				return lines.join("\n");
			},
			padToWidth: true,
		});
	}
	const envelope = details as Partial<ToolContext<Record<string, unknown>>>;

	const stale = envelope.cache?.staleness;
	const sourceLabel = envelope.cache?.cached
		? toolActivity(`\u21BB cache hit${stale ? ` ${stale}` : ""}`, theme)
		: toolSuccess("\u21BB fresh fetch", theme);

	const summary = envelope.error
		? toolStatus([`${envelope.mode ?? ""} mode`, envelope.format ?? ""], theme)
		: toolStatus(
				[
					`${toolStatusDot(envelope.status, theme)} ${envelope.status ?? ""}`,
					`${envelope.mode ?? ""} mode`,
					envelope.format,
					sourceLabel,
					{ text: fmtDuration(envelope.timing?.durationMs) ?? "", tone: "muted" },
					toolFreshnessLabel(envelope),
					expanded ? undefined : toolExpandHint,
				],
				theme,
			);
	const data = envelope.data;
	const field =
		data && typeof data === "object" ? (data.markdown ?? data.text ?? data.title) : undefined;
	const previewValue = envelope.answerContext ?? field ?? result.content.at(0)?.text ?? "";
	const preview =
		typeof previewValue === "string"
			? previewValue
			: typeof previewValue === "number" || typeof previewValue === "boolean"
				? String(previewValue)
				: JSON.stringify(previewValue);
	const url = envelope.finalUrl ?? envelope.url ?? "unknown URL";
	const state = envelope.error ? "error" : "done";
	return toolStackedCard(
		{
			body: (width) =>
				toolResourceStatus({
					url,
					label: state,
					state,
					width,
					theme,
				}),
			summary,
			expanded,
			notice: toolSessionNotice(envelope),
			expandedSections: (width) => {
				const ct = envelope.contentType ?? "";
				if (
					/^(?:application\/octet-stream|application\/pdf|image\/|audio\/|video\/)/u.test(ct) ||
					!!(envelope.data && typeof envelope.data === "object" && "fileSize" in envelope.data)
				)
					return [toolFileResultCard(envelope, theme).render(width).join("\n")];
				const out = [toolResultTree(buildScrapeSections(envelope, theme), width, theme)];
				if (preview && !markdownPreviewComponent(envelope.format, preview, theme))
					out.push(
						(envelope.format === "json" ||
						envelope.format === "html" ||
						envelope.format === "ax-tree"
							? `\`\`\`${envelope.format}\n${preview}\n\`\`\``
							: preview
						).slice(0, 1200),
					);
				return out;
			},
			markdownPreview: () => markdownPreviewComponent(envelope.format, preview, theme),
			responseId: envelope.responseId,
			hasError: !!envelope.error,
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
	return new Markdown(preview.slice(0, 1200), 0, 0, toolMarkdownTheme(theme));
}

function buildScrapeSections(
	envelope: Partial<ToolContext<Record<string, unknown>>>,
	theme?: RenderTheme,
): ReturnType<typeof buildToolResultTree> {
	const headers = envelope.headers;
	const hasHeaders = !!headers && Object.keys(headers).length > 0;
	const groups = new Map<string, ToolResultGroup["rows"]>();
	const t = envelope.data?.title;
	const d = envelope.data?.description;

	addScrapeRow(groups, "page", "title", typeof t === "string" && t ? t : undefined);
	if (hasHeaders) {
		const url = envelope.finalUrl ?? envelope.url;
		const host =
			typeof url === "string" && URL.canParse(url)
				? new URL(url).hostname.replace(/^www\./iu, "")
				: undefined;
		addScrapeRow(groups, "page", "site", host);
	}
	addScrapeRow(groups, "page", "description", typeof d === "string" && d ? d : undefined);

	addScrapeRow(groups, "details", "url", envelope.url);
	if (envelope.finalUrl && envelope.finalUrl !== envelope.url)
		addScrapeRow(groups, "details", "final", envelope.finalUrl);
	addScrapeRow(groups, "details", "status", envelope.status ? String(envelope.status) : undefined);
	addScrapeRow(groups, "details", "mode", envelope.mode);
	addScrapeRow(groups, "details", "format", envelope.format);
	addScrapeRow(groups, "details", "size", fmtBytes(envelope.downloadedBytes));
	addScrapeRow(groups, "details", "duration", fmtDuration(envelope.timing?.durationMs));
	addScrapeRow(groups, "details", "type", envelope.contentType);
	addScrapeRow(groups, "details", "source", envelope.cache?.cached ? "cache hit" : "fresh fetch");

	const chunks = envelope.data?.chunks as Chunk[] | undefined;
	if (chunks?.length) {
		addScrapeRow(groups, "chunks", "count", String(chunks.length));
		addScrapeRow(
			groups,
			"chunks",
			"tokens",
			`${chunks.reduce((sum, chunk) => sum + chunk.tokenCount, 0)} total`,
		);
	}

	if (envelope.error) {
		const code = envelope.error.code;
		addScrapeRow(
			groups,
			"error",
			"code",
			code ? (theme ? toolFailure(code, theme) : code) : undefined,
		);
		addScrapeRow(groups, "error", "phase", envelope.error.phase);
		addScrapeRow(groups, "error", "message", envelope.error.message);
	}

	if (hasHeaders) addHeaderSections(groups, envelope, headers);
	return buildToolResultTree(Array.from(groups.entries(), ([name, rows]) => ({ name, rows })));
}

function addHeaderSections(
	groups: Map<string, ToolResultGroup["rows"]>,
	envelope: Partial<ToolContext<Record<string, unknown>>>,
	headers: Record<string, string>,
): void {
	addScrapeRow(groups, "cache", "status", headers["cf-cache-status"]);
	if (headers["age"]) {
		const n = Number(headers["age"]);
		const sec = Number.isFinite(n) && n >= 0 ? n : undefined;
		addScrapeRow(groups, "cache", "age", sec !== undefined ? formatSeconds(sec) : headers["age"]);
	}
	const cc = parseCacheControl(headers["cache-control"]);
	const cdnCc = parseCacheControl(headers["cdn-cache-control"]);
	const fmtCc = (maxAge: number, swr: number | undefined) =>
		`max-age ${formatSeconds(maxAge)}${swr ? `  +swr ${formatSeconds(swr)}` : ""}`;
	const primary = cdnCc ?? cc;
	if (primary) addScrapeRow(groups, "cache", "cdn", fmtCc(primary.maxAge, primary.swr));
	if (cc?.maxAge !== undefined && (!cdnCc || cdnCc.maxAge !== cc.maxAge)) {
		const swr = cc.swr && (!cdnCc || cdnCc.swr !== cc.swr) ? cc.swr : undefined;
		addScrapeRow(groups, "cache", "browser", fmtCc(cc.maxAge, swr));
	}

	addScrapeRow(groups, "server", "vendor", headers["server"]);
	if (headers["cf-ray"]) {
		const di = headers["cf-ray"].lastIndexOf("-");
		const ray = di !== -1 ? headers["cf-ray"].slice(0, di) : headers["cf-ray"];
		const loc = di !== -1 ? headers["cf-ray"].slice(di + 1) : "";
		addScrapeRow(groups, "server", "ray", `${ray}${loc ? `  \u2192  ${loc}` : ""}`);
	}

	if (headers["date"]) addScrapeRow(groups, "time", "fetched", formatHttpTime(headers["date"]));
	if (headers["last-modified"]) {
		const now = new Date(headers["date"] ?? Date.now()).getTime();
		const diffSec = Math.floor((now - new Date(headers["last-modified"]).getTime()) / 1000);
		addScrapeRow(
			groups,
			"time",
			"modified",
			`${formatHttpTime(headers["last-modified"])}${diffSec > 0 ? `  (${formatSeconds(diffSec)} ago)` : ""}`,
		);
	}

	const headerEntries = Object.entries(headers).filter(([, v]) => typeof v === "string");
	for (const [k, v] of headerEntries)
		addScrapeRow(groups, "headers", `${k}:`, v.length > 120 ? `${v.slice(0, 120)}...` : v);

	const respId = envelope.responseId ?? "";
	if (respId || headerEntries.length > 0) {
		if (respId) addScrapeRow(groups, "trace", "response", respId.slice(0, 8));
		addScrapeRow(groups, "trace", "headers", `${headerEntries.length} total`);
	}
}

function addScrapeRow(
	groups: Map<string, ToolResultGroup["rows"]>,
	group: string,
	key: string,
	value: string | undefined,
): void {
	if (value === undefined || value === "") return;
	const rows = groups.get(group) ?? [];
	rows.push([key, value]);
	groups.set(group, rows);
}

const fmtTwoUnit = (whole: number, big: string, rem: number, small: string) =>
	rem > 0 ? `${whole}${big} ${rem}${small}` : `${whole}${big}`;

function formatSeconds(s: number): string {
	if (s < 60) return `${s}s`;
	if (s < 3600) return fmtTwoUnit(Math.floor(s / 60), "m", s % 60, "s");
	if (s < 86400) return fmtTwoUnit(Math.floor(s / 3600), "h", Math.floor((s % 3600) / 60), "m");
	return fmtTwoUnit(Math.floor(s / 86400), "d", Math.floor((s % 86400) / 3600), "h");
}

function parseCacheControl(value: string | undefined) {
	if (!value) return;
	let maxAge: number | undefined;
	let swr: number | undefined;
	for (const part of value.toLowerCase().split(",")) {
		const t = part.trim();
		const eq = t.indexOf("=");
		if (eq === -1) continue;
		const key = t.slice(0, eq);
		const n = Number(t.slice(eq + 1));
		if (!Number.isFinite(n)) continue;
		if (key === "max-age" || key === "s-maxage") maxAge = n;
		else if (key === "stale-while-revalidate") swr = n;
	}
	return maxAge !== undefined ? { maxAge, swr } : undefined;
}

function formatHttpTime(s: string): string {
	const d = new Date(s);
	return Number.isNaN(d.getTime()) ? s : `${d.toISOString().slice(11, 19)} GMT`;
}
