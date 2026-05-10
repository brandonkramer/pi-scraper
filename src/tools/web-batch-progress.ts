/**
 * @fileoverview Tool-specific batch/crawl progress view conversions.
 */
import type { CrawlPageView } from "./web-renderer-views.ts";
import type { BatchProgressView } from "../batch/progress-state.ts";

export {
	type BatchProgressStatus,
	type BatchProgressItemView,
	type BatchProgressView,
	cloneBatchProgress,
	isBatchProgress,
	isBatchProgressView,
	updateIndexedBatchProgress,
	updateUrlBatchProgress,
	batchProgressFromItems,
} from "../batch/progress-state.ts";

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
