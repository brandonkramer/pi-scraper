import { DEFAULT_CONCURRENCY, DEFAULT_CRAWL_LIMITS } from "../defaults.js";
import { createHttpClient } from "../http/client.js";
import { discoverSiteUrls, type SiteMapDeps } from "../map/discover.js";
import {
	type ScrapePipelineDeps,
	type ScrapeResult,
	scrapeUrl,
} from "../scrape/pipeline.js";
import type { CommonScrapeOptions, StructuredError } from "../types.js";
import {
	appendJobError,
	createJobManifest,
	structuredErrorToJobError,
	unknownToJobError,
	updateJobManifest,
	writeJobManifest,
	type JobError,
} from "../storage/jobs.js";
import { CrawlFrontier, type FrontierItem } from "./frontier.js";
import {
	type CrawlMetadata,
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
	message?: string;
	metadata?: CrawlMetadata;
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
	resume?: boolean;
	concurrency?: number;
	perHostConcurrency?: number;
	onProgress?: (progress: CrawlProgress) => void;
}

export interface CrawlRunResult {
	crawlId: string;
	pages: ScrapeResult[];
	visited: string[];
	statePath: string;
	metadata: CrawlMetadata;
	jobManifestPath?: string;
}

export async function runCrawl(
	seedUrl: string,
	options: CrawlRunOptions = {},
	deps: ScrapePipelineDeps & SiteMapDeps = {},
	signal?: AbortSignal,
): Promise<CrawlRunResult> {
	const shouldResume =
		options.crawlId !== undefined && options.resume !== false;
	const loaded = shouldResume
		? await loadCrawlState(options.crawlId as string, options).catch(
				() => undefined,
			)
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
	const sharedDeps = deps.httpClient
		? deps
		: {
				...deps,
				httpClient: createHttpClient({
					globalConcurrency: concurrency,
					perHostConcurrency:
						options.perHostConcurrency ?? DEFAULT_CONCURRENCY.perHost,
					retryAttempts: options.retryAttempts,
				}),
			};
	const injectedHostLimits = deps.httpClient
		? new HostLimitPool(
				options.perHostConcurrency ?? DEFAULT_CONCURRENCY.perHost,
			)
		: undefined;
	const counts = {
		succeeded: state.metadata?.succeededCount ?? state.results.length,
		failed: state.metadata?.failedCount ?? 0,
	};
	let jobErrors: JobError[] = state.metadata?.lastError
		? [state.metadata.lastError]
		: [];
	let totalBytes = 0;
	let totalChars = 0;
	let truncatedPages = 0;
	let jobManifestPath = await writeJobManifest(
		createJobManifest({
			jobId: state.crawlId,
			jobType: "crawl",
			createdAt: state.createdAt,
			params: { seedUrl, ...options },
			mode: options.mode,
			format: options.format,
		}),
		options,
	);
	const progressTotal = counts.succeeded + counts.failed + maxPages;
	const activeItems = new Map<string, FrontierItem>();
	let currentDepth = state.metadata?.currentDepth;
	let maxDepthVisited = state.metadata?.maxDepthVisited ?? 0;
	let statePath = "";
	let persistChain: Promise<CrawlMetadata | undefined> =
		Promise.resolve(undefined);

	const coordinator = new CrawlCoordinator(frontier, maxPages, signal);
	const queuedMetadata = await persist("queued");
	options.onProgress?.({
		state: "queued",
		current: counts.succeeded + counts.failed,
		total: progressTotal,
		url: seedUrl,
		message: progressSummary(queuedMetadata, progressTotal),
		metadata: queuedMetadata,
	});

	async function persist(
		status: CrawlMetadata["status"],
		lastError?: CrawlMetadata["lastError"],
	): Promise<CrawlMetadata> {
		persistChain = persistChain
			.catch(() => undefined)
			.then(async () => {
				state.frontier = [...activeItems.values(), ...frontier.remaining()];
				state.visited = frontier.visitedUrls();
				state.metadata = {
					...(state.metadata ?? {
						crawlId: state.crawlId,
						seedUrl: state.seedUrl,
						createdAt: state.createdAt,
						updatedAt: state.updatedAt,
						status,
						visitedCount: 0,
						frontierCount: 0,
						succeededCount: 0,
						failedCount: 0,
					}),
					status,
					visitedCount: state.visited.length,
					frontierCount: state.frontier.length,
					succeededCount: counts.succeeded,
					failedCount: counts.failed,
					currentDepth,
					maxDepthVisited,
					lastError: lastError ?? state.metadata?.lastError,
				};
				statePath = await saveCrawlState(state, options);
				const manifest = await updateJobManifest(
					state.crawlId,
					{
						status: status === "running" ? "running" : status,
						startedAt: new Date().toISOString(),
						completedAt:
							status === "running" || status === "queued"
								? undefined
								: new Date().toISOString(),
						urlsProcessed: counts.succeeded + counts.failed,
						urlsFailed: counts.failed,
						errors: jobErrors,
						totalBytes,
						totalChars,
						truncatedPages,
					},
					options,
				);
				jobManifestPath = manifest.path;
				return state.metadata;
			});
		return (await persistChain) as CrawlMetadata;
	}

	async function worker(): Promise<void> {
		while (true) {
			const item = await coordinator.next();
			if (!item) return;
			activeItems.set(item.url, item);
			currentDepth = item.depth;
			maxDepthVisited = Math.max(maxDepthVisited, item.depth);
			const processingMetadata = await persist("running");
			options.onProgress?.({
				state: "processing",
				current: counts.succeeded + counts.failed,
				total: progressTotal,
				url: item.url,
				message: progressSummary(processingMetadata, progressTotal),
				metadata: processingMetadata,
			});
			const releaseHost = await injectedHostLimits?.acquire(
				new URL(item.url).host,
				signal,
			);
			let completed = false;
			try {
				const result = await scrapeUrl(item.url, options, sharedDeps, signal);
				pages.push(result);
				if (result.error) {
					counts.failed += 1;
					jobErrors = appendJobError(
						jobErrors,
						structuredErrorToJobError(result.error),
					);
				} else counts.succeeded += 1;
				totalBytes += result.downloadedBytes ?? 0;
				totalChars += resultChars(result);
				if (result.truncated) truncatedPages += 1;
				for (const link of extractLinks(result))
					frontier.enqueue(link, item.depth + 1, item.url);
				completed = true;
				activeItems.delete(item.url);
				const doneMetadata = await persist(
					"running",
					result.error ? errorSummary(result.error) : undefined,
				);
				options.onProgress?.({
					state: result.error ? "error" : "done",
					current: counts.succeeded + counts.failed,
					total: progressTotal,
					url: item.url,
					message: progressSummary(doneMetadata, progressTotal),
					metadata: doneMetadata,
				});
			} finally {
				releaseHost?.();
				if (completed) activeItems.delete(item.url);
				coordinator.done();
			}
		}
	}

	try {
		await Promise.all(
			Array.from({ length: Math.min(concurrency, maxPages) }, () => worker()),
		);
		state.results = [
			...state.results,
			...pages.map((page) => page.finalUrl ?? page.url ?? "").filter(Boolean),
		];
		const finalStatus = frontier.size > 0 ? "paused" : "done";
		const metadata = await persist(finalStatus);
		return {
			crawlId: state.crawlId,
			pages,
			visited: state.visited,
			statePath,
			metadata,
			jobManifestPath,
		};
	} catch (error) {
		const status = isAbortError(error, signal) ? "paused" : "error";
		const summary = unknownErrorSummary(error);
		jobErrors = appendJobError(jobErrors, unknownToJobError(error, "crawl"));
		await persist(status, summary);
		throw error;
	}
}

function extractLinks(result: ScrapeResult): string[] {
	const links = result.data.links ?? [];
	return links
		.map((link) =>
			typeof link === "string" ? link : (link as { url?: string }).url,
		)
		.filter(Boolean) as string[];
}

function resultChars(result: ScrapeResult): number {
	return (
		result.data.markdown?.length ??
		result.data.text?.length ??
		result.data.html?.length ??
		0
	);
}

function progressSummary(metadata: CrawlMetadata, maxPages: number): string {
	const done = metadata.succeededCount + metadata.failedCount;
	return `${done}/${maxPages} pages · ${metadata.failedCount} failed · depth ${metadata.currentDepth ?? 0} · frontier ${metadata.frontierCount}`;
}

function errorSummary(
	error: StructuredError,
): Pick<StructuredError, "code" | "message" | "phase" | "url"> {
	return {
		code: error.code,
		message: error.message,
		phase: error.phase,
		url: error.url,
	};
}

function unknownErrorSummary(
	error: unknown,
): Pick<StructuredError, "code" | "message" | "phase" | "url"> {
	if (typeof error === "object" && error !== null && "structured" in error) {
		return errorSummary((error as { structured: StructuredError }).structured);
	}
	return {
		code: error instanceof Error ? error.name : "CRAWL_ERROR",
		message: error instanceof Error ? error.message : "Crawl failed",
		phase: "crawl",
	};
}

function isAbortError(error: unknown, signal?: AbortSignal): boolean {
	return (
		signal?.aborted === true ||
		(error instanceof Error && error.name === "AbortError")
	);
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
