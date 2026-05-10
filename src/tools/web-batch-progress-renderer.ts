/**
 * @fileoverview Transitional re-export shim for batch/crawl/map renderer modules.
 *
 * Import from focused modules directly for new code:
 * - web-batch-progress.ts  — progress view state
 * - web-batch-details.ts   — batch expanded result details
 * - web-crawl-details.ts   — crawl expanded page details
 * - web-map-renderers.ts   — map result card
 * - web-batch-renderers.ts — batch progress/result card UI
 */

export {
	type BatchProgressItemView,
	type BatchProgressStatus,
	type BatchProgressView,
	batchProgressFromCrawlPages,
	batchProgressFromItems,
	cloneBatchProgress,
	isBatchProgress,
	isBatchProgressView,
	updateIndexedBatchProgress,
	updateUrlBatchProgress,
} from "./web-batch-progress.ts";

export { batchExpandedDetails } from "./web-batch-details.ts";
export { crawlExpandedDetails } from "./web-crawl-details.ts";
export { renderMapResultCard } from "./web-map-renderers.ts";
export {
	renderBatchProgressCard,
	renderBatchResultCard,
} from "./web-batch-renderers.ts";
