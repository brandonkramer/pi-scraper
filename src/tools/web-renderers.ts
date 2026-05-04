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

const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function renderWebToolCall(
	name: `web_${string}`,
	parts: Array<string | undefined>,
	theme?: RenderTheme,
	context?: ToolRenderContext,
	options: { donePrefix?: string | false; animate?: boolean } = {},
): RenderComponent {
	const label = `${name} ${parts.filter(Boolean).join(" ")}`.trim();
	if (context?.isPartial) {
		if (options.animate !== false) return renderSpinner(label, theme, context);
		return renderText(accent(label, theme));
	}
	const prefix = options.donePrefix === undefined ? "✓" : options.donePrefix;
	return renderText(accent(prefix ? `${prefix} ${label}` : label, theme));
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
				envelope.status ?? "ok",
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
	});
}

export function renderWebCrawlResult(
	result: PiToolShell,
	expanded = false,
): RenderComponent {
	const details = result.details as
		| Partial<ResultEnvelope<unknown>>
		| ProgressDetails;
	if (isProgress(details)) return renderProgress("web_crawl", details);
	const envelope = details as Partial<ResultEnvelope<{ metadata?: CrawlMeta }>>;
	const metadata = envelope.data?.metadata;
	const failed = metadata?.failedCount ?? 0;
	const title = envelope.error
		? errorTitle("web_crawl", envelope.error)
		: `✓ web_crawl ${metadata?.succeededCount ?? 0} succeeded · ${failed} failed · ${metadata?.visitedCount ?? 0} visited · frontier ${metadata?.frontierCount ?? 0}`;
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
): RenderComponent {
	const details = result.details as
		| Partial<ResultEnvelope<unknown>>
		| ProgressDetails;
	if (isProgress(details)) return renderProgress("web_batch", details);
	const envelope = details as Partial<ResultEnvelope<BatchItem[]>>;
	const items = Array.isArray(envelope.data) ? envelope.data : [];
	const succeeded = items.filter((item) => item.ok === true).length;
	const failed = items.length - succeeded;
	const cacheHits = items.filter(
		(item) => item.ok === true && item.result?.cache?.cached,
	).length;
	const title = envelope.error
		? errorTitle("web_batch", envelope.error)
		: `✓ ${succeeded} succeeded · ✕ ${failed} failed · ↻ ${cacheHits} cache hits`;
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
	});
}

export function renderWebHistoryResult(
	result: PiToolShell,
	expanded = false,
): RenderComponent {
	const envelope = result.details as Partial<
		ResultEnvelope<{ entries?: HistoryEntry[] }>
	>;
	return renderPlainLookupResult(result, envelope, expanded);
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
	return renderLookupResult(title, result, envelope, expanded);
}

export function renderWebSearchScrapesResult(
	result: PiToolShell,
	expanded = false,
): RenderComponent {
	const envelope = result.details as Partial<ResultEnvelope<SearchData>>;
	const data = envelope.data;
	const title =
		data?.supported === false
			? "⚠ search unavailable"
			: data?.hits?.length
				? `✓ ${data.hits.length} stored hits`
				: "↻ scrape/search first";
	return renderLookupResult(title, result, envelope, expanded);
}

function renderLookupResult(
	title: string,
	result: PiToolShell,
	envelope: Partial<ResultEnvelope<unknown>>,
	expanded: boolean,
): RenderComponent {
	const summary = envelope.summary ? `${title} · ${envelope.summary}` : title;
	return renderChecklistResult(summary, expanded, {
		preview: envelope.answerContext ?? result.content[0]?.text,
		responseId: envelope.responseId,
	});
}

function renderPlainLookupResult(
	result: PiToolShell,
	envelope: Partial<ResultEnvelope<unknown>>,
	expanded: boolean,
): RenderComponent {
	return renderChecklistResult(
		envelope.summary ?? result.content[0]?.text ?? "done",
		expanded,
		{
			preview: envelope.answerContext ?? result.content[0]?.text,
			responseId: envelope.responseId,
		},
	);
}

function renderChecklistResult(
	title: string,
	expanded: boolean,
	options: { items?: ChecklistItem[]; preview?: string; responseId?: string },
): RenderComponent {
	if (!expanded) {
		const id = options.responseId ? ` · responseId: ${options.responseId}` : "";
		return renderText(`${title}${id}`.slice(0, 240));
	}
	const lines = [title];
	if (options.items?.length) {
		lines.push("", ...options.items.map(formatChecklistItem));
	}
	if (options.preview) lines.push("", options.preview.slice(0, 500));
	if (options.responseId) lines.push("", `responseId: ${options.responseId}`);
	return renderText(lines.join("\n"));
}

function renderProgress(
	toolName: `web_${string}`,
	details: ProgressDetails,
): RenderComponent {
	const count = details.total
		? ` ${details.current ?? 0}/${details.total}`
		: "";
	const message = details.message ? ` · ${details.message}` : "";
	const url = details.url ? ` · ${details.url}` : "";
	const icon =
		details.state === "error" ? "✕" : details.state === "done" ? "✓" : "⠋";
	const lines = [
		`${icon} ${toolName} ${details.state}${count}${url}${message}`,
	];
	if (details.checklist?.length)
		lines.push(...details.checklist.map(formatChecklistItem));
	if (details.counts) {
		const counts = details.counts;
		lines.push(
			[
				counts.succeeded === undefined
					? undefined
					: `✓ ${counts.succeeded} succeeded`,
				counts.failed === undefined ? undefined : `✕ ${counts.failed} failed`,
				counts.cacheHits === undefined
					? undefined
					: `↻ ${counts.cacheHits} cache hits`,
			]
				.filter(Boolean)
				.join(" · "),
		);
	}
	return renderText(lines.filter(Boolean).join("\n"));
}

function renderSpinner(
	label: string,
	theme: RenderTheme | undefined,
	context: ToolRenderContext,
): RenderComponent {
	const key = `${label}:spinner`;
	const existing = context.state?.[key];
	if (existing instanceof SpinnerComponent) return existing;
	const component = new SpinnerComponent(label, theme, context.invalidate);
	if (context.state) context.state[key] = component;
	return component;
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
	return `✕ ${tool} ${error.code}: ${error.message}`;
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

class SpinnerComponent implements RenderComponent {
	private frameIndex = 0;
	private timer: ReturnType<typeof setInterval> | undefined;

	constructor(
		private readonly label: string,
		private readonly theme: RenderTheme | undefined,
		private readonly requestRender: (() => void) | undefined,
	) {
		this.start();
	}

	render(width: number): string[] {
		return renderText(
			accent(`${spinnerFrames[this.frameIndex]} ${this.label}`, this.theme),
		).render(width);
	}

	invalidate(): void {
		this.stop();
	}

	private start(): void {
		if (!this.requestRender || this.timer) return;
		this.timer = setInterval(() => {
			this.frameIndex = (this.frameIndex + 1) % spinnerFrames.length;
			this.requestRender?.();
		}, 120);
		this.timer.unref?.();
	}

	private stop(): void {
		if (!this.timer) return;
		clearInterval(this.timer);
		this.timer = undefined;
	}
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
