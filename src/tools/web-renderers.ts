import type {
	PiToolShell,
	ProgressDetails,
	ResultEnvelope,
	StructuredError,
} from "../types.js";
import type {
	RenderComponent,
	RenderTheme,
	ToolRenderContext,
} from "./define.js";
import { renderText } from "./render.js";

export type ChecklistState = "done" | "pending" | "failed" | "warning" | "info";

export interface ChecklistItem {
	label: string;
	state: ChecklistState;
	detail?: string;
}

export function renderWebToolCall(
	name: `web_${string}`,
	parts: Array<string | undefined>,
	theme?: RenderTheme,
	_context?: ToolRenderContext,
	_options: { donePrefix?: string | false; animate?: boolean } = {},
): RenderComponent {
	const label = `${name} ${parts.filter(Boolean).join(" ")}`.trim();
	return renderText(accent(label, theme));
}

export function renderWebScrapeResult(
	result: PiToolShell,
	expanded = false,
): RenderComponent {
	const details = result.details as
		| Partial<ResultEnvelope<unknown>>
		| ProgressDetails;
	if (isProgress(details)) return renderProgress("web_scrape", details);
	const envelope = details as Partial<ResultEnvelope<Record<string, unknown>>>;
	const title = envelope.error
		? errorTitle("web_scrape", envelope.error)
		: [
				`web_scrape ${envelope.status ?? "ok"}`,
				envelope.mode,
				envelope.format,
				cacheLabel(envelope),
			]
				.filter(Boolean)
				.join(" · ");
	return renderChecklistResult(title, expanded, {
		items: [
			{ label: "URL validated", state: envelope.url ? "done" : "info" },
			{ label: "robots checked", state: "info", detail: "when enabled" },
			fetchChecklistItem(envelope),
			{ label: "parsed/extracted", state: envelope.data ? "done" : "info" },
			{ label: "stored result", state: envelope.responseId ? "done" : "info" },
		],
		preview: previewText(result, envelope),
		responseId: envelope.responseId,
		icons: false,
	});
}

export function renderWebCrawlResult(
	result: PiToolShell,
	expanded = false,
	theme?: RenderTheme,
): RenderComponent {
	const details = result.details as
		| Partial<ResultEnvelope<unknown>>
		| ProgressDetails;
	if (isProgress(details)) return renderProgress("web_crawl", details, theme);
	const envelope = details as Partial<ResultEnvelope<{ metadata?: CrawlMeta }>>;
	const metadata = envelope.data?.metadata;
	const failed = metadata?.failedCount ?? 0;
	const title = envelope.error
		? errorTitle("web_crawl", envelope.error)
		: `${successCountSegment(metadata?.succeededCount ?? 0, "succeeded", theme)} · ${failureCountSegment(failed, "failed", theme)} · ${activityCountSegment(metadata?.visitedCount ?? 0, "visited", "🌐", theme)} · → frontier ${metadata?.frontierCount ?? 0}`;
	return renderChecklistResult(title, expanded, {
		items: [
			{ label: "robots checked", state: "done" },
			{ label: "sitemap seeded", state: "info", detail: "when available" },
			{ label: "pages fetched", state: failed > 0 ? "warning" : "done" },
			{ label: "results stored", state: envelope.responseId ? "done" : "info" },
			{ label: "crawl state saved", state: metadata ? "done" : "info" },
		],
		preview: envelope.answerContext ?? result.content[0]?.text,
		responseId: envelope.responseId,
	});
}

export function renderWebBatchResult(
	result: PiToolShell,
	expanded = false,
	theme?: RenderTheme,
): RenderComponent {
	const details = result.details as
		| Partial<ResultEnvelope<unknown>>
		| ProgressDetails;
	if (isProgress(details)) return renderProgress("web_batch", details, theme);
	const envelope = details as Partial<ResultEnvelope<BatchItem[]>>;
	const items = Array.isArray(envelope.data) ? envelope.data : [];
	const succeeded = items.filter((item) => item.ok === true).length;
	const failed = items.length - succeeded;
	const cacheHits = items.filter(
		(item) => item.ok === true && item.result?.cache?.cached,
	).length;
	const title = envelope.error
		? errorTitle("web_batch", envelope.error)
		: `${successCountSegment(succeeded, "succeeded", theme)} · ${failureCountSegment(failed, "failed", theme)} · ${activityCountSegment(cacheHits, "cache hits", "🔄", theme)}`;
	return renderChecklistResult(title, expanded, {
		items: [
			{ label: `${succeeded} succeeded`, state: succeeded ? "done" : "info" },
			{ label: `${failed} failed`, state: failed ? "failed" : "done" },
			{
				label: `${cacheHits} cache hits`,
				state: cacheHits ? "info" : "pending",
			},
		],
		preview: batchPreview(items) || envelope.answerContext,
		responseId: envelope.responseId,
	});
}

export function renderWebDiffResult(
	result: PiToolShell,
	expanded = false,
): RenderComponent {
	const details = result.details as
		| Partial<ResultEnvelope<unknown>>
		| ProgressDetails;
	if (isProgress(details)) return renderProgress("web_diff", details);
	const envelope = details as Partial<ResultEnvelope<DiffData>>;
	const diff = envelope.data;
	const title = envelope.error
		? errorTitle("web_diff", envelope.error)
		: diffTitle(diff, envelope.summary);
	return renderChecklistResult(title, expanded, {
		items: [
			{ label: "fetched current page", state: diff?.current ? "done" : "info" },
			{
				label: "loaded previous snapshot",
				state: diff?.previous ? "done" : "warning",
			},
			{ label: "compared normalized content", state: diff ? "done" : "info" },
			{ label: "saved snapshot", state: envelope.responseId ? "done" : "info" },
		],
		preview: envelope.answerContext ?? result.content[0]?.text,
		responseId: envelope.responseId,
		icons: false,
	});
}

export function renderWebHistoryResult(
	result: PiToolShell,
	expanded = false,
): RenderComponent {
	const envelope = result.details as Partial<
		ResultEnvelope<{ entries?: HistoryEntry[] }>
	>;
	const entries = envelope.data?.entries ?? [];
	const hasResponse = entries.some((entry) => Boolean(entry.responseId));
	const stale = envelope.qualitySignals?.freshness === "stale_possible";
	const title =
		hasResponse && !stale ? "reusable result found" : "refresh recommended";
	return renderLookupResult(title, result, envelope, expanded);
}

export function renderWebCrawlsResult(
	result: PiToolShell,
	expanded = false,
): RenderComponent {
	const envelope = result.details as Partial<
		ResultEnvelope<{ crawls?: CrawlEntry[] }>
	>;
	const crawls = envelope.data?.crawls ?? [];
	const action = crawls.find(
		(crawl) => crawl.recommendedAction,
	)?.recommendedAction;
	const title =
		action === "resume"
			? "↻ resume crawl"
			: action === "recrawl"
				? "⚠ recrawl recommended"
				: action === "reuse_results"
					? "✓ reusable crawl"
					: crawls.length
						? "⚠ inspect crawl history"
						: "↻ crawl first";
	return renderLookupResult(title, result, envelope, expanded, { icons: true });
}

export function renderWebSearchScrapesResult(
	result: PiToolShell,
	expanded = false,
): RenderComponent {
	const envelope = result.details as Partial<ResultEnvelope<SearchData>>;
	const data = envelope.data;
	const title =
		data?.supported === false
			? "search unavailable"
			: data?.hits?.length
				? `${data.hits.length} stored hits`
				: "scrape/search first";
	return renderLookupResult(title, result, envelope, expanded);
}

function renderLookupResult(
	title: string,
	result: PiToolShell,
	envelope: Partial<ResultEnvelope<unknown>>,
	expanded: boolean,
	options: { icons?: boolean } = {},
): RenderComponent {
	const summary = envelope.summary ? `${title} · ${envelope.summary}` : title;
	return renderChecklistResult(summary, expanded, {
		preview: envelope.answerContext ?? result.content[0]?.text,
		responseId: envelope.responseId,
		icons: options.icons ?? false,
	});
}

function renderChecklistResult(
	title: string,
	expanded: boolean,
	options: {
		items?: ChecklistItem[];
		preview?: string;
		responseId?: string;
		icons?: boolean;
	},
): RenderComponent {
	if (!expanded) {
		const id = options.responseId ? ` · responseId: ${options.responseId}` : "";
		return renderText(`${title}${id}`.slice(0, 240));
	}
	const lines = [title];
	if (options.items?.length) {
		const formatter =
			options.icons === false ? formatChecklistText : formatChecklistItem;
		lines.push("", ...options.items.map(formatter));
	}
	if (options.preview) lines.push("", options.preview.slice(0, 500));
	if (options.responseId) lines.push("", `responseId: ${options.responseId}`);
	return renderText(lines.join("\n"));
}

function toolAllowsIcons(toolName: `web_${string}`): boolean {
	return toolName === "web_batch" || toolName === "web_crawl";
}

function renderProgress(
	toolName: `web_${string}`,
	details: ProgressDetails,
	theme?: RenderTheme,
): RenderComponent {
	const count = details.total
		? ` ${details.current ?? 0}/${details.total}`
		: "";
	const message = details.message ? ` · ${details.message}` : "";
	const url = details.url ? ` · ${details.url}` : "";
	const icons = toolAllowsIcons(toolName);
	const prefix = icons && details.state === "error" ? "✕ " : "";
	const lines = [
		`${prefix}${toolName} ${details.state}${count}${url}${message}`,
	];
	if (details.checklist?.length) {
		const formatter = icons ? formatChecklistItem : formatChecklistText;
		lines.push(...details.checklist.map(formatter));
	}
	if (details.counts) {
		const counts = details.counts;
		lines.push(
			[
				counts.succeeded === undefined
					? undefined
					: icons
						? successCountSegment(counts.succeeded, "succeeded", theme)
						: `${counts.succeeded} succeeded`,
				counts.failed === undefined
					? undefined
					: icons
						? failureCountSegment(counts.failed, "failed", theme)
						: `${counts.failed} failed`,
				counts.cacheHits === undefined
					? undefined
					: icons
						? activityCountSegment(counts.cacheHits, "cache hits", "🔄", theme)
						: `${counts.cacheHits} cache hits`,
			]
				.filter(Boolean)
				.join(" · "),
		);
	}
	return renderText(lines.filter(Boolean).join("\n"));
}

function successCountSegment(
	count: number,
	label: string,
	theme?: RenderTheme,
): string {
	const text = `${count} ${label}`;
	if (count <= 0) return text;
	return successText(`✅ ${text}`, theme);
}

function failureCountSegment(
	count: number,
	label: string,
	theme?: RenderTheme,
): string {
	return failureText(`❌ ${count} ${label}`, theme);
}

function successText(text: string, theme?: RenderTheme): string {
	const themed = theme?.fg?.("success", text);
	if (themed) return themed;
	return `\u001B[38;2;148;226;213m${text}\u001B[0m`;
}

function activityCountSegment(
	count: number,
	label: string,
	icon: string,
	theme?: RenderTheme,
): string {
	return activityText(`${icon} ${count} ${label}`, theme);
}

function failureText(text: string, theme?: RenderTheme): string {
	const themed = theme?.fg?.("error", text) ?? theme?.fg?.("danger", text);
	if (themed) return themed;
	return `\u001B[38;2;239;118;122m${text}\u001B[0m`;
}

function activityText(text: string, theme?: RenderTheme): string {
	const themed = theme?.fg?.("warning", text) ?? theme?.fg?.("accent", text);
	if (themed) return themed;
	return `\u001B[38;2;199;211;111m${text}\u001B[0m`;
}

function formatChecklistItem(item: ChecklistItem): string {
	const icon =
		item.state === "done"
			? "✓"
			: item.state === "failed"
				? "✕"
				: item.state === "warning"
					? "⚠"
					: item.state === "pending"
						? "☐"
						: "•";
	return `${icon} ${item.label}${item.detail ? ` — ${item.detail}` : ""}`;
}

function formatChecklistText(item: ChecklistItem): string {
	return `${item.label}${item.detail ? ` — ${item.detail}` : ""}`;
}

function fetchChecklistItem(
	envelope: Partial<ResultEnvelope<unknown>>,
): ChecklistItem {
	if (envelope.cache?.cached) {
		return {
			label: "cache hit",
			state: "done",
			detail: envelope.cache.staleness,
		};
	}
	return { label: "fetched page", state: envelope.status ? "done" : "info" };
}

function cacheLabel(
	envelope: Partial<ResultEnvelope<unknown>>,
): string | undefined {
	if (!envelope.cache?.cached) return undefined;
	return `↻ cache hit${envelope.cache.staleness ? ` ${envelope.cache.staleness}` : ""}`;
}

function errorTitle(tool: `web_${string}`, error: StructuredError): string {
	const prefix = toolAllowsIcons(tool) ? "✕ " : "";
	return `${prefix}${tool} ${error.code}: ${error.message}`;
}

function previewText(
	result: PiToolShell,
	envelope: Partial<ResultEnvelope<Record<string, unknown>>>,
): string {
	const data = envelope.data;
	return String(
		envelope.answerContext ??
			data?.markdown ??
			data?.text ??
			data?.title ??
			result.content[0]?.text ??
			"",
	);
}

function batchPreview(items: BatchItem[]): string {
	return items
		.slice(0, 5)
		.map((item) =>
			item.ok
				? `✓ ${item.url}`
				: `✕ ${item.url}: ${item.error?.message ?? "failed"}`,
		)
		.join("\n");
}

function diffTitle(
	diff: DiffData | undefined,
	summary: string | undefined,
): string {
	if (!diff?.previous) return "saved baseline";
	if (summary?.includes("No meaningful") || summary?.includes("No content"))
		return "no content changes";
	return `changed: ${diff.diff?.changedCount ?? 0} changed, ${diff.diff?.addedCount ?? 0} added, ${diff.diff?.removedCount ?? 0} removed`;
}

function accent(text: string, theme?: RenderTheme): string {
	return theme?.fg?.("accent", text) ?? text;
}

function isProgress(value: unknown): value is ProgressDetails {
	return Boolean(
		value &&
			typeof value === "object" &&
			"_progress" in value &&
			(value as ProgressDetails)._progress,
	);
}

interface CrawlMeta {
	succeededCount: number;
	failedCount: number;
	visitedCount: number;
	frontierCount: number;
}

interface BatchItem {
	ok?: boolean;
	url?: string;
	result?: { cache?: { cached?: boolean } };
	error?: { message?: string };
}

interface DiffData {
	previous?: unknown;
	current?: unknown;
	diff?: { changedCount?: number; addedCount?: number; removedCount?: number };
}

interface HistoryEntry {
	responseId?: string;
}

interface CrawlEntry {
	recommendedAction?: string;
}

interface SearchData {
	supported?: boolean;
	hits?: unknown[];
}
