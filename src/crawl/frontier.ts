/** @file Crawl frontier module. */
import { compactQueue } from "../url/dedupe.ts";
import { normalizeUrl } from "../url/normalize.ts";
import { matchesAny } from "../url/patterns.ts";

export type CrawlStrategy = "bfs" | "dfs" | "best-first";

export interface FrontierItem {
	url: string;
	depth: number;
	parentUrl?: string;
	/** @internal Priority score for best-first strategy. Set during enqueue. */
	_priorityScore?: number;
}

export interface FrontierOptions {
	seedUrl: string;
	maxDepth?: number;
	sameOrigin?: boolean;
	include?: string[];
	exclude?: string[];
	strategy?: CrawlStrategy;
	initialQueue?: FrontierItem[];
	initialSeen?: string[];
}

export class CrawlFrontier {
	private readonly queue: FrontierItem[] = [];
	private queueHead = 0;
	private readonly seen = new Set<string>();
	private readonly seedOrigin: string;

	constructor(private readonly options: FrontierOptions) {
		this.seedOrigin = new URL(normalizeUrl(options.seedUrl)).origin;
		for (const url of options.initialSeen ?? []) this.seen.add(normalizeUrl(url));
		this.queue.push(...(options.initialQueue ?? []));
	}

	enqueue(url: string, depth: number, parentUrl?: string): boolean {
		const normalized = normalizeUrl(url);
		if (!this.allowed(normalized, depth) || this.seen.has(normalized)) return false;
		this.seen.add(normalized);
		const item: FrontierItem = { url: normalized, depth, parentUrl };
		const strategy = this.options.strategy ?? "bfs";
		if (strategy === "dfs") {
			// Depth-first: insert at the front of the queue (LIFO)
			// Deeper items get higher priority (more negative score)
			item._priorityScore = -item.depth;
			this.queue.splice(this.queueHead, 0, item);
		} else if (strategy === "best-first") {
			// Best-first: insert sorted by priority score (highest first)
			const score = bestFirstScore(item);
			item._priorityScore = score;
			const insertAt = this.findInsertPosition(score);
			this.queue.splice(insertAt, 0, item);
		} else {
			// BFS (default): push to the end (FIFO)
			this.queue.push(item);
		}
		return true;
	}

	/**
	 * Find the index where a new item with the given score should be inserted to keep the queue
	 * sorted by descending score. Only searches the unprocessed portion (queueHead → end).
	 */
	private findInsertPosition(score: number): number {
		for (let i = this.queueHead; i < this.queue.length; i++) {
			const existing = this.queue[i];
			// oxlint-disable-next-line typescript/no-unnecessary-condition -- array element may be sparse
			if (existing && score > (existing._priorityScore ?? 0)) return i;
		}
		return this.queue.length;
	}

	next(): FrontierItem | undefined {
		if (this.queueHead >= this.queue.length) return;
		const item = this.queue[this.queueHead];
		this.queueHead += 1;
		this.queueHead = compactQueue(this.queue, this.queueHead);
		return item;
	}

	remaining(): FrontierItem[] {
		return this.queue.slice(this.queueHead);
	}

	visitedUrls(): string[] {
		return [...this.seen];
	}

	get size(): number {
		return this.queue.length - this.queueHead;
	}

	private allowed(url: string, depth: number): boolean {
		if (depth > (this.options.maxDepth ?? 3)) return false;
		if ((this.options.sameOrigin ?? true) && new URL(url).origin !== this.seedOrigin) return false;
		if (matchesAny(url, this.options.exclude)) return false;
		if (this.options.include?.length && !matchesAny(url, this.options.include)) return false;
		return true;
	}
}

/**
 * Priority score for best-first strategy. Higher score = crawled earlier. Factor in depth
 * (shallower = higher) and URL patterns (index/section pages preferred over deep content pages).
 */
export function bestFirstScore(item: FrontierItem, maxDepth = 5): number {
	let score = (maxDepth - item.depth) * 10;
	try {
		const pathname = new URL(item.url).pathname;
		// Index/root pages get a boost
		if (pathname === "/" || /^\/index\.\w+$/u.test(pathname)) score += 5;
		// Short paths (sections) get a moderate boost
		else if (pathname === "" || pathname.split("/").filter(Boolean).length <= 1) score += 3;
		// Bookmarks/fragment-only pages get a small boost
		if (item.url.includes("#")) score += 1;
	} catch {
		// Malformed URL — keep base score
	}
	return score;
}
