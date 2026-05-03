import { normalizeUrl } from "../url/normalize.js";
import { matchesAny } from "../url/patterns.js";

export interface FrontierItem {
	url: string;
	depth: number;
	parentUrl?: string;
}

export interface FrontierOptions {
	seedUrl: string;
	maxDepth?: number;
	sameOrigin?: boolean;
	include?: string[];
	exclude?: string[];
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
		for (const url of options.initialSeen ?? [])
			this.seen.add(normalizeUrl(url));
		this.queue.push(...(options.initialQueue ?? []));
	}

	enqueue(url: string, depth: number, parentUrl?: string): boolean {
		const normalized = normalizeUrl(url);
		if (!this.allowed(normalized, depth) || this.seen.has(normalized))
			return false;
		this.seen.add(normalized);
		this.queue.push({ url: normalized, depth, parentUrl });
		return true;
	}

	next(): FrontierItem | undefined {
		if (this.queueHead >= this.queue.length) return undefined;
		const item = this.queue[this.queueHead];
		this.queueHead += 1;
		this.compactQueue();
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

	private compactQueue(): void {
		const consumed = this.queueHead;
		if (consumed < 1024 || consumed <= this.queue.length - consumed) return;
		this.queue.splice(0, consumed);
		this.queueHead = 0;
	}

	private allowed(url: string, depth: number): boolean {
		if (depth > (this.options.maxDepth ?? 3)) return false;
		if (
			(this.options.sameOrigin ?? true) &&
			new URL(url).origin !== this.seedOrigin
		)
			return false;
		if (matchesAny(url, this.options.exclude)) return false;
		if (this.options.include?.length && !matchesAny(url, this.options.include))
			return false;
		return true;
	}
}
