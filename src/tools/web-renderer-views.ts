/**
 * @fileoverview View-shaped read models consumed by Pi web tool renderers (BatchItem, CrawlPageView, MapUrlEntryView, DiffData). Decoupled from the canonical envelope types in src/types.ts.
 */

export interface CrawlMeta {
	succeededCount: number;
	failedCount: number;
	visitedCount: number;
	frontierCount: number;
}

export interface BatchItem {
	ok?: boolean;
	url?: string;
	result?: {
		url?: string;
		finalUrl?: string;
		status?: number;
		mode?: string;
		format?: string;
		contentType?: string;
		downloadedBytes?: number;
		truncated?: boolean;
		timing?: { durationMs?: number; fetchMs?: number; parseMs?: number };
		cache?: { cached?: boolean; staleness?: string; ageSeconds?: number };
		data?: {
			title?: string;
			description?: string;
			markdown?: string;
			text?: string;
			route?: string;
		};
	};
	error?: { code?: string; phase?: string; message?: string };
}

export interface MapUrlEntryView {
	url: string;
	source?: string;
	title?: string;
}

export interface CrawlPageView {
	ok?: boolean;
	url?: string;
	finalUrl?: string;
	status?: number;
	mode?: string;
	format?: string;
	contentType?: string;
	downloadedBytes?: number;
	truncated?: boolean;
	timing?: { durationMs?: number };
	cache?: { cached?: boolean; staleness?: string };
	data?: {
		title?: string;
		description?: string;
		markdown?: string;
		text?: string;
	};
	error?: { code?: string; phase?: string; message?: string };
}

export interface DiffData {
	previous?: unknown;
	current?: unknown;
	diff?: { changedCount?: number; addedCount?: number; removedCount?: number };
}
