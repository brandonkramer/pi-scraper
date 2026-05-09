/**
 * @fileoverview Compact Pi renderer for web_batch per-URL progress.
 */
import type { ProgressDetails } from "../types.js";
import type { RenderComponent, RenderTheme } from "./define.js";
import { renderText } from "./render.js";
import {
	formatBytes,
	formatDuration,
	inlineThemeText,
	muted,
	renderProgressBar,
	renderStackedResultCard,
	renderStatusPill as renderSharedStatusPill,
	renderUrlStatusRow,
	truncateMiddle,
	withSpinnerFooter,
} from "./shared-renderers.js";
import type {
	BatchItem,
	CrawlPageView,
	MapUrlEntryView,
} from "./web-renderer-types.js";

export type BatchProgressStatus = "queued" | "processing" | "done" | "error";

export interface BatchProgressItemView {
	url: string;
	status: BatchProgressStatus;
	error?: string;
	progress?: number;
	startedAtMs?: number;
}

export interface BatchProgressView {
	total: number;
	completed: number;
	succeeded: number;
	failed: number;
	concurrency: number;
	items: BatchProgressItemView[];
	label?: string;
}

export function isBatchProgress(
	details: ProgressDetails<unknown>,
): details is ProgressDetails<{ batchProgress: BatchProgressView }> {
	const data = details.data as { batchProgress?: unknown } | undefined;
	return isBatchProgressView(data?.batchProgress);
}

export function isBatchProgressView(
	value: unknown,
): value is BatchProgressView {
	return typeof value === "object" && value !== null && "items" in value;
}

export function cloneBatchProgress(
	progress: BatchProgressView,
): BatchProgressView {
	return { ...progress, items: progress.items.map((item) => ({ ...item })) };
}

export function updateIndexedBatchProgress(
	progress: BatchProgressView,
	state: BatchProgressStatus,
	current: number,
	url?: string,
): void {
	if (state === "queued") return;
	const index = state === "processing" ? current : current - 1;
	const item = progress.items[index];
	if (!item) return;
	applyProgressItemStatus(item, state, url);
	recountBatchProgress(progress);
}

export function updateUrlBatchProgress(
	progress: BatchProgressView,
	state: string,
	url?: string,
): void {
	if (!url) return;
	const status = batchStatusFromState(state);
	let item = progress.items.find((entry) => entry.url === url);
	if (!item) {
		item = { url, status: "queued" };
		progress.items.push(item);
	}
	applyProgressItemStatus(item, status, url);
	progress.total = Math.max(progress.total, progress.items.length);
	recountBatchProgress(progress);
}

function applyProgressItemStatus(
	item: BatchProgressItemView,
	status: BatchProgressStatus,
	url?: string,
): void {
	item.status = status;
	if (status === "processing" && typeof item.startedAtMs !== "number")
		item.startedAtMs = Date.now();
	if (status === "done") item.progress = 1;
	if (url) item.url = url;
}

function batchStatusFromState(state: string): BatchProgressStatus {
	if (state === "done" || state === "error" || state === "processing")
		return state;
	return state === "queued" || state === "waiting" ? "queued" : "processing";
}

function recountBatchProgress(progress: BatchProgressView): void {
	progress.completed = progress.items.filter(
		(entry) => entry.status === "done" || entry.status === "error",
	).length;
	progress.succeeded = progress.items.filter(
		(entry) => entry.status === "done",
	).length;
	progress.failed = progress.items.filter(
		(entry) => entry.status === "error",
	).length;
}

export function batchProgressFromItems(
	items: readonly BatchItem[],
	concurrency?: number,
): BatchProgressView {
	const succeeded = items.filter((item) => item.ok === true).length;
	const failed = items.length - succeeded;
	return {
		total: items.length,
		completed: items.length,
		succeeded,
		failed,
		concurrency: concurrency ?? items.length,
		items: items.map((item) => ({
			url: item.url ?? "unknown URL",
			status: item.ok === false ? "error" : "done",
			error: item.error?.message,
		})),
	};
}

export function batchExpandedDetails(
	items: readonly BatchItem[],
	metadata: { jobId?: unknown; packageResponseId?: unknown } = {},
): string {
	const lines = ["Per-URL details:"];
	for (const item of items.slice(0, 20)) {
		lines.push(...batchItemDetails(item));
	}
	if (items.length > 20) lines.push(`… ${items.length - 20} more URL(s)`);
	const jobId = typeof metadata.jobId === "string" ? metadata.jobId : undefined;
	const packageResponseId =
		typeof metadata.packageResponseId === "string"
			? metadata.packageResponseId
			: undefined;
	if (jobId || packageResponseId) {
		lines.push("", "Stored handles:");
		if (jobId) lines.push(`jobId: ${jobId}`);
		if (packageResponseId)
			lines.push(`packageResponseId: ${packageResponseId}`);
	}
	return lines.join("\n");
}

function batchItemDetails(item: BatchItem): string[] {
	if (!item.ok) {
		const error = item.error;
		return [
			`✕ ${item.url ?? "unknown URL"}`,
			`  ${[error?.code, error?.phase, error?.message ?? "failed"].filter(Boolean).join(" · ")}`,
		];
	}
	const result = item.result;
	const url = item.url ?? result?.url ?? "unknown URL";
	const fields = [
		result?.status ? `status ${result.status}` : undefined,
		result?.mode,
		result?.format,
		result?.contentType,
		formatBytes(result?.downloadedBytes),
		formatDuration(result?.timing?.durationMs),
		result?.cache?.cached
			? `cache hit${result.cache.staleness ? ` ${result.cache.staleness}` : ""}`
			: undefined,
		result?.truncated ? "truncated" : undefined,
	].filter(Boolean);
	const lines = [`✓ ${url}`, `  ${fields.join(" · ") || "fetched"}`];
	if (result?.finalUrl && result.finalUrl !== url)
		lines.push(`  final: ${result.finalUrl}`);
	if (result?.data?.title) lines.push(`  title: ${result.data.title}`);
	const excerpt = resultExcerpt(result);
	if (excerpt) lines.push(`  excerpt: ${excerpt}`);
	return lines;
}

function resultExcerpt(result: BatchItem["result"]): string | undefined {
	const value =
		result?.data?.description ??
		result?.data?.markdown ??
		result?.data?.text ??
		result?.data?.route;
	if (!value) return undefined;
	return String(value).replace(/\s+/g, " ").trim().slice(0, 180);
}

export function batchProgressFromCrawlPages(
	pages: readonly CrawlPageView[],
	concurrency?: number,
): BatchProgressView {
	const succeeded = pages.filter((p) => !p.error).length;
	const failed = pages.length - succeeded;
	return {
		total: pages.length,
		completed: pages.length,
		succeeded,
		failed,
		concurrency: concurrency ?? pages.length,
		items: pages.map((page) => ({
			url: page.finalUrl ?? page.url ?? "unknown URL",
			status: page.error ? "error" : "done",
			error: page.error?.message,
		})),
	};
}

export function crawlExpandedDetails(
	pages: readonly CrawlPageView[],
	metadata: { jobId?: unknown; packageResponseId?: unknown } = {},
): string {
	const lines = ["Per-page details:"];
	for (const page of pages.slice(0, 20)) {
		lines.push(...crawlPageDetails(page));
	}
	if (pages.length > 20) lines.push(`… ${pages.length - 20} more page(s)`);
	const jobId = typeof metadata.jobId === "string" ? metadata.jobId : undefined;
	const packageResponseId =
		typeof metadata.packageResponseId === "string"
			? metadata.packageResponseId
			: undefined;
	if (jobId || packageResponseId) {
		lines.push("", "Stored handles:");
		if (jobId) lines.push(`jobId: ${jobId}`);
		if (packageResponseId)
			lines.push(`packageResponseId: ${packageResponseId}`);
	}
	return lines.join("\n");
}

function crawlPageDetails(page: CrawlPageView): string[] {
	if (page.error) {
		return [
			`✕ ${page.finalUrl ?? page.url ?? "unknown URL"}`,
			`  ${[page.error.code, page.error.phase, page.error.message ?? "failed"].filter(Boolean).join(" · ")}`,
		];
	}
	const url = page.finalUrl ?? page.url ?? "unknown URL";
	const fields = [
		page.status ? `status ${page.status}` : undefined,
		page.mode,
		page.format,
		page.contentType,
		formatBytes(page.downloadedBytes),
		formatDuration(page.timing?.durationMs),
		page.cache?.cached
			? `cache hit${page.cache.staleness ? ` ${page.cache.staleness}` : ""}`
			: undefined,
		page.truncated ? "truncated" : undefined,
	].filter(Boolean);
	const lines = [`✓ ${url}`, `  ${fields.join(" · ") || "fetched"}`];
	if (page.finalUrl && page.url && page.finalUrl !== page.url)
		lines.push(`  final: ${page.finalUrl}`);
	if (page.data?.title) lines.push(`  title: ${page.data.title}`);
	const excerpt =
		page.data?.description ?? page.data?.markdown ?? page.data?.text;
	if (excerpt)
		lines.push(
			`  excerpt: ${String(excerpt).replace(/\s+/g, " ").trim().slice(0, 180)}`,
		);
	return lines;
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
		invalidate() {},
	};
}

function renderMapRow(
	entry: MapUrlEntryView,
	width: number,
	theme?: RenderTheme,
): string {
	const badgeText = entry.source ? `[ ${entry.source} ]` : "";
	const badgeWidth = badgeText.length;
	const urlWidth = Math.max(12, width - badgeWidth - 2);
	const url =
		inlineThemeText("accent", truncateMiddle(entry.url, urlWidth), theme) ??
		truncateMiddle(entry.url, urlWidth);
	const badge = badgeText ? muted(badgeText, theme) : "";
	return badge ? `${url} ${badge}` : url;
}

export function renderBatchProgressCard(
	details: ProgressDetails<{
		batchProgress: BatchProgressView;
		spinnerTick?: number;
	}>,
	expanded: boolean,
	theme?: RenderTheme,
): RenderComponent {
	const batch = details.data?.batchProgress;
	const tick = details.data?.spinnerTick;
	return {
		render(width: number) {
			const text = batch
				? renderBatchProgressText(batch, width, expanded, theme)
				: muted("No batch progress available.", theme);
			const isDone = batch ? batch.completed >= batch.total : false;
			const lines = text.split("\n");
			if (!isDone) {
				return renderText(withSpinnerFooter(lines, tick)).render(width);
			}
			return renderText(lines.join("\n")).render(width);
		},
		invalidate() {},
	};
}

export function renderBatchResultCard(
	options: {
		progress: BatchProgressView;
		summary: string;
		notice?: string;
		preview?: string;
		responseId?: string;
		padToWidth?: boolean;
	},
	expanded: boolean,
	theme?: RenderTheme,
): RenderComponent {
	return renderStackedResultCard(
		{
			body: (width) =>
				renderBatchProgressText(options.progress, width, expanded, theme),
			summary: options.summary,
			expanded,
			notice: options.notice,
			expandedSections: () => [options.preview?.slice(0, 500)],
			responseId: options.responseId,
			padToWidth: options.padToWidth,
		},
		theme,
	);
}

function renderBatchProgressText(
	batch: BatchProgressView,
	width: number,
	expanded: boolean,
	theme?: RenderTheme,
): string {
	const label = batch.label ?? "web_batch";
	const title = [
		theme?.bold?.(label) ?? label,
		muted(`${batch.completed}/${batch.total} done`, theme),
		muted(`ok ${batch.succeeded}`, theme),
		muted(`err ${batch.failed}`, theme),
		muted(`concurrency ${batch.concurrency}`, theme),
	].join(" · ");
	const rows = batch.items
		.slice(0, expanded ? batch.items.length : 12)
		.map((item) => renderBatchRow(item, width, theme));
	const more =
		!expanded && batch.items.length > rows.length
			? [muted(`… ${batch.items.length - rows.length} more urls`, theme)]
			: [];
	return [title, ...rows, ...more].join("\n");
}

function renderBatchRow(
	item: BatchProgressItemView,
	width: number,
	theme?: RenderTheme,
): string {
	const statusWidth = Math.max(12, Math.min(18, Math.floor(width * 0.22)));
	return renderUrlStatusRow({
		url: item.url,
		label: statusLabel(item.status),
		state: statusPillState(item.status),
		width,
		theme,
		startedAtMs: item.startedAtMs,
		statusBox: renderStatusBox(item, statusWidth, theme),
	});
}

function renderStatusBox(
	item: BatchProgressItemView,
	width: number,
	theme?: RenderTheme,
): string {
	if (item.status === "processing" && typeof item.progress === "number") {
		return renderProgressBar(item.progress, width - 2);
	}
	return renderSharedStatusPill({
		label: statusLabel(item.status),
		state: statusPillState(item.status),
		width,
		theme,
		startedAtMs: item.startedAtMs,
	});
}

function statusPillState(status: BatchProgressStatus) {
	if (status === "queued") return "waiting";
	if (status === "processing") return "loading";
	return status;
}

function statusLabel(status: BatchProgressStatus): string {
	if (status === "queued") return "waiting";
	if (status === "processing") return "loading";
	return status;
}
