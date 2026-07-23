import type { ProgressDetails } from "../types.ts";
/** @file Batch/crawl progress view state and update helpers. */
import type { BatchItemResult } from "./run.ts";

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

export function isBatchProgress(details: ProgressDetails<unknown>): details is ProgressDetails<{
	batchProgress: BatchProgressView;
	spinnerTick?: number;
}> {
	const data = details.data as { batchProgress?: unknown } | undefined;
	return isBatchProgressView(data?.batchProgress);
}

export function isBatchProgressView(value: unknown): value is BatchProgressView {
	return typeof value === "object" && value !== null && "items" in value;
}

export function cloneBatchProgress(progress: BatchProgressView): BatchProgressView {
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
	// oxlint-disable-next-line typescript/no-unnecessary-condition -- defensive guard; runtime conditions can diverge from inferred type
	if (!item) return;
	const previousStatus = item.status;
	applyProgressItemStatus(item, state, url);
	adjustBatchProgressCounts(progress, previousStatus, item.status);
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
	const previousStatus = item.status;
	applyProgressItemStatus(item, status, url);
	progress.total = Math.max(progress.total, progress.items.length);
	adjustBatchProgressCounts(progress, previousStatus, item.status);
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
	if (state === "done" || state === "error" || state === "processing") return state;
	return state === "queued" || state === "waiting" ? "queued" : "processing";
}

function adjustBatchProgressCounts(
	progress: BatchProgressView,
	previousStatus: BatchProgressStatus,
	nextStatus: BatchProgressStatus,
): void {
	if (previousStatus === nextStatus) return;
	if (isCompleted(previousStatus)) progress.completed -= 1;
	if (isCompleted(nextStatus)) progress.completed += 1;
	if (previousStatus === "done") progress.succeeded -= 1;
	if (nextStatus === "done") progress.succeeded += 1;
	if (previousStatus === "error") progress.failed -= 1;
	if (nextStatus === "error") progress.failed += 1;
}

function isCompleted(status: BatchProgressStatus): boolean {
	return status === "done" || status === "error";
}

interface CrawlPageLike {
	url?: string;
	finalUrl?: string;
	error?: { message?: string };
}

export function batchProgressFromCrawlPages(
	pages: readonly CrawlPageLike[],
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

export function batchProgressFromItems(
	items: readonly BatchItemResult[],
	concurrency?: number,
): BatchProgressView {
	const succeeded = items.filter((item) => item.ok).length;
	const failed = items.length - succeeded;
	return {
		total: items.length,
		completed: items.length,
		succeeded,
		failed,
		concurrency: concurrency ?? items.length,
		items: items.map((item) => ({
			url:
				// oxlint-disable-next-line typescript/no-unnecessary-condition -- defensive guard; runtime conditions can diverge from inferred type
				item.ok && item.result ? (item.result.finalUrl ?? item.result.url ?? item.url) : item.url,
			status: !item.ok ? "error" : "done",
			// oxlint-disable-next-line typescript/no-unnecessary-condition -- capture group/optional field may be undefined at runtime
			error: !item.ok ? item.error?.message : undefined,
		})),
	};
}
