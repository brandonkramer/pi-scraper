/** @fileoverview Shared renderer-only structural types kept out of web-renderers to preserve file-size limits. */

export interface CrawlMeta {
	succeededCount: number;
	failedCount: number;
	visitedCount: number;
	frontierCount: number;
}

export interface BatchItem {
	ok?: boolean;
	url?: string;
	result?: { cache?: { cached?: boolean } };
	error?: { message?: string };
}

export interface DiffData {
	previous?: unknown;
	current?: unknown;
	diff?: { changedCount?: number; addedCount?: number; removedCount?: number };
}
