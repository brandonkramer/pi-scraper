import { DEFAULT_CONCURRENCY, DEFAULT_CRAWL_LIMITS } from "../defaults.js";
import { discoverSiteUrls, type SiteMapDeps } from "../map/discover.js";
import {
	type ScrapePipelineDeps,
	type ScrapeResult,
	scrapeUrl,
} from "../scrape/pipeline.js";
import type { CommonScrapeOptions } from "../types.js";
import { CrawlFrontier } from "./frontier.js";
import {
	type CrawlStateOptions,
	createCrawlState,
	loadCrawlState,
	saveCrawlState,
} from "./state.js";

export interface CrawlProgress {
	state: "queued" | "processing" | "done" | "error";
	current: number;
	total?: number;
	url?: string;
}

export interface CrawlRunOptions
	extends CommonScrapeOptions,
		CrawlStateOptions {
	maxPages?: number;
	maxDepth?: number;
	sameOrigin?: boolean;
	include?: string[];
	exclude?: string[];
	seedSitemap?: boolean;
	concurrency?: number;
	perHostConcurrency?: number;
	onProgress?: (progress: CrawlProgress) => void;
}

export interface CrawlRunResult {
	crawlId: string;
	pages: ScrapeResult[];
	visited: string[];
	statePath: string;
}

export async function runCrawl(
	seedUrl: string,
	options: CrawlRunOptions = {},
	deps: ScrapePipelineDeps & SiteMapDeps = {},
	signal?: AbortSignal,
): Promise<CrawlRunResult> {
	const loaded = options.crawlId
		? await loadCrawlState(options.crawlId, options).catch(() => undefined)
		: undefined;
	const state = loaded ?? createCrawlState(seedUrl, options.crawlId);
	const frontier = new CrawlFrontier({
		seedUrl: state.seedUrl,
		maxDepth: options.maxDepth ?? DEFAULT_CRAWL_LIMITS.maxDepth,
		sameOrigin: options.sameOrigin ?? DEFAULT_CRAWL_LIMITS.sameOrigin,
		include: options.include,
		exclude: options.exclude,
		initialQueue: state.frontier,
		initialSeen: state.visited,
	});
	if (!loaded) frontier.enqueue(seedUrl, 0);

	if (!loaded && options.seedSitemap === true) {
		const mapped = await discoverSiteUrls(seedUrl, {}, deps, signal).catch(
			() => undefined,
		);
		for (const entry of mapped?.urls ?? [])
			frontier.enqueue(entry.url, 1, seedUrl);
	}

	const pages: ScrapeResult[] = [];
	const maxPages = options.maxPages ?? DEFAULT_CRAWL_LIMITS.maxPages;
	const concurrency = Math.max(
		1,
		options.concurrency ?? DEFAULT_CONCURRENCY.global,
	);
	const perHostConcurrency = Math.max(
		1,
		options.perHostConcurrency ?? DEFAULT_CONCURRENCY.perHost,
	);
	const hostLimits = new HostLimitPool(perHostConcurrency);
	const coordinator = new CrawlCoordinator(frontier, maxPages, signal);
	options.onProgress?.({
		state: "queued",
		current: 0,
		total: maxPages,
		url: seedUrl,
	});

	async function worker(): Promise<void> {
		while (true) {
			const item = await coordinator.next();
			if (!item) return;
			options.onProgress?.({
				state: "processing",
				current: pages.length,
				total: maxPages,
				url: item.url,
			});
			const releaseHost = await hostLimits.acquire(
				new URL(item.url).host,
				signal,
			);
			try {
				const result = await scrapeUrl(item.url, options, deps, signal);
				pages.push(result);
				options.onProgress?.({
					state: result.error ? "error" : "done",
					current: pages.length,
					total: maxPages,
					url: item.url,
				});
				for (const link of extractLinks(result))
					frontier.enqueue(link, item.depth + 1, item.url);
			} finally {
				releaseHost();
				coordinator.done();
			}
		}
	}

	await Promise.all(
		Array.from({ length: Math.min(concurrency, maxPages) }, () => worker()),
	);

	state.frontier = frontier.remaining();
	state.visited = frontier.visitedUrls();
	state.results = [
		...state.results,
		...pages.map((page) => page.finalUrl ?? page.url ?? "").filter(Boolean),
	];
	const statePath = await saveCrawlState(state, options);
	return { crawlId: state.crawlId, pages, visited: state.visited, statePath };
}

function extractLinks(result: ScrapeResult): string[] {
	const links = result.data.links ?? [];
	return links
		.map((link) =>
			typeof link === "string" ? link : (link as { url?: string }).url,
		)
		.filter(Boolean) as string[];
}

class CrawlCoordinator {
	private active = 0;
	private scheduled = 0;
	private readonly waiters: Array<() => void> = [];

	constructor(
		private readonly frontier: CrawlFrontier,
		private readonly maxPages: number,
		private readonly signal?: AbortSignal,
	) {}

	async next(): Promise<ReturnType<CrawlFrontier["next"]>> {
		while (this.scheduled < this.maxPages) {
			if (this.signal?.aborted)
				throw (
					this.signal.reason ?? new DOMException("Crawl aborted", "AbortError")
				);
			const item = this.frontier.next();
			if (item) {
				this.scheduled += 1;
				this.active += 1;
				return item;
			}
			if (this.active === 0) return undefined;
			await this.waitForWork();
		}
		return undefined;
	}

	done(): void {
		this.active = Math.max(0, this.active - 1);
		this.notify();
	}

	private waitForWork(): Promise<void> {
		return new Promise((resolve, reject) => {
			const wake = () => {
				cleanup();
				resolve();
			};
			const onAbort = () => {
				cleanup();
				const index = this.waiters.indexOf(wake);
				if (index >= 0) this.waiters.splice(index, 1);
				reject(
					this.signal?.reason ??
						new DOMException("Crawl aborted", "AbortError"),
				);
			};
			const cleanup = () => this.signal?.removeEventListener("abort", onAbort);
			this.waiters.push(wake);
			this.signal?.addEventListener("abort", onAbort, { once: true });
		});
	}

	private notify(): void {
		for (const wake of this.waiters.splice(0)) queueMicrotask(wake);
	}
}

type Release = () => void;

interface HostQueue {
	items: Array<() => void>;
	head: number;
}

class HostLimitPool {
	private readonly active = new Map<string, number>();
	private readonly queues = new Map<string, HostQueue>();

	constructor(private readonly perHostLimit: number) {}

	async acquire(host: string, signal?: AbortSignal): Promise<Release> {
		if (signal?.aborted)
			throw signal.reason ?? new DOMException("Crawl aborted", "AbortError");
		if ((this.active.get(host) ?? 0) < this.perHostLimit) {
			this.active.set(host, (this.active.get(host) ?? 0) + 1);
			return () => this.release(host);
		}

		return new Promise<Release>((resolve, reject) => {
			const run = () => {
				cleanup();
				this.active.set(host, (this.active.get(host) ?? 0) + 1);
				resolve(() => this.release(host));
			};
			const onAbort = () => {
				cleanup();
				const queue = this.hostQueue(host);
				const index = queue.items.indexOf(run);
				if (index >= queue.head) queue.items.splice(index, 1);
				reject(
					signal?.reason ?? new DOMException("Crawl aborted", "AbortError"),
				);
			};
			const cleanup = () => signal?.removeEventListener("abort", onAbort);
			this.hostQueue(host).items.push(run);
			signal?.addEventListener("abort", onAbort, { once: true });
		});
	}

	private release(host: string): void {
		this.active.set(host, Math.max(0, (this.active.get(host) ?? 1) - 1));
		const queue = this.queues.get(host);
		const next = queue?.items[queue.head];
		if (!queue || !next) return;
		queue.head += 1;
		this.compactHostQueue(host, queue);
		queueMicrotask(next);
	}

	private hostQueue(host: string): HostQueue {
		const existing = this.queues.get(host);
		if (existing) return existing;
		const created = { items: [], head: 0 };
		this.queues.set(host, created);
		return created;
	}

	private compactHostQueue(host: string, queue: HostQueue): void {
		const consumed = queue.head;
		if (consumed < 1024 || consumed <= queue.items.length - consumed) return;
		queue.items.splice(0, consumed);
		queue.head = 0;
		if (queue.items.length === 0) this.queues.delete(host);
	}
}
