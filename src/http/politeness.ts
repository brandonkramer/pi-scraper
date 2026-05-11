/** @file Http politeness module. */
import { DEFAULT_CONCURRENCY } from "../defaults.ts";
import { compactQueue } from "../url/dedupe.ts";

export interface PolitenessOptions {
	globalConcurrency?: number;
	perHostConcurrency?: number;
	minDelayMs?: number;
}

export type Release = () => void;

export class Semaphore {
	private active = 0;
	private readonly queue: Array<() => void> = [];
	private queueHead = 0;

	constructor(private limit: number) {}

	setLimit(limit: number): void {
		this.limit = Math.max(1, Math.floor(limit));
		this.drain();
	}

	async acquire(signal?: AbortSignal): Promise<Release> {
		if (signal?.aborted) {
			throw signal.reason ?? new DOMException("Operation aborted", "AbortError");
		}

		if (this.active < this.limit) {
			this.active += 1;
			return () => this.release();
		}

		return await new Promise<Release>((resolve, reject) => {
			const run = () => {
				cleanup();
				resolve(() => this.release());
			};
			const onAbort = () => {
				cleanup();
				const index = this.queue.indexOf(run);
				if (index >= this.queueHead) {
					this.queue.splice(index, 1);
				}
				reject(signal?.reason ?? new DOMException("Operation aborted", "AbortError"));
			};
			const cleanup = () => signal?.removeEventListener("abort", onAbort);

			this.queue.push(run);
			signal?.addEventListener("abort", onAbort, { once: true });
		});
	}

	private release(): void {
		this.active = Math.max(0, this.active - 1);
		this.drain();
	}

	private drain(): void {
		while (this.active < this.limit) {
			const next = this.queue[this.queueHead];
			// oxlint-disable-next-line typescript/no-unnecessary-condition -- defensive guard; runtime conditions can diverge from inferred type
			if (!next) return;
			this.active += 1;
			this.queueHead += 1;
			this.queueHead = compactQueue(this.queue, this.queueHead);
			queueMicrotask(next);
		}
	}
}

export class KeyedSemaphore {
	private readonly semaphores = new Map<string, Semaphore>();

	constructor(private readonly limit: number) {}

	async acquire(key: string, signal?: AbortSignal): Promise<Release> {
		return await this.semaphore(key).acquire(signal);
	}

	private semaphore(key: string): Semaphore {
		const existing = this.semaphores.get(key);
		if (existing) return existing;
		const created = new Semaphore(this.limit);
		this.semaphores.set(key, created);
		return created;
	}
}

interface HostState {
	semaphore: Semaphore;
	limit: number;
	baseLimit: number;
	retryAfterUntil?: number;
	last429?: number;
}

export class PolitenessController {
	private readonly globalSemaphore: Semaphore;
	private readonly hostStates = new Map<string, HostState>();
	private readonly hostAvailableAt = new Map<string, number>();

	constructor(private readonly options: PolitenessOptions = {}) {
		this.globalSemaphore = new Semaphore(options.globalConcurrency ?? DEFAULT_CONCURRENCY.global);
	}

	async run<T>(
		host: string,
		crawlDelayMs: number | undefined,
		signal: AbortSignal | undefined,
		task: () => Promise<T>,
	): Promise<T> {
		const globalRelease = await this.globalSemaphore.acquire(signal);
		const hostRelease = await this.hostSemaphore(host).acquire(signal);
		try {
			await this.waitTurn(host, crawlDelayMs, signal);
			return await task();
		} finally {
			hostRelease();
			globalRelease();
		}
	}

	noteResponse(host: string, status: number, retryAfterMs?: number): void {
		const state = this.hostState(host);
		if (status === 429) {
			state.last429 = Date.now();
			if (retryAfterMs !== undefined) {
				state.retryAfterUntil = Math.max(state.retryAfterUntil ?? 0, Date.now() + retryAfterMs);
			}
			state.limit = Math.max(1, Math.floor(state.limit / 2));
			state.semaphore.setLimit(state.limit);
			return;
		}
		if (status >= 200 && status < 400 && state.limit < state.baseLimit) {
			state.limit += 1;
			state.semaphore.setLimit(state.limit);
		}
	}

	private hostSemaphore(host: string): Semaphore {
		return this.hostState(host).semaphore;
	}

	private hostState(host: string): HostState {
		const existing = this.hostStates.get(host);
		if (existing) return existing;
		const baseLimit = this.options.perHostConcurrency ?? DEFAULT_CONCURRENCY.perHost;
		const created: HostState = {
			baseLimit,
			limit: baseLimit,
			semaphore: new Semaphore(baseLimit),
		};
		this.hostStates.set(host, created);
		return created;
	}

	private async waitTurn(host: string, crawlDelayMs?: number, signal?: AbortSignal): Promise<void> {
		const delayMs = Math.max(this.options.minDelayMs ?? 0, crawlDelayMs ?? 0);
		const now = Date.now();
		const availableAt = Math.max(
			this.hostAvailableAt.get(host) ?? now,
			this.hostState(host).retryAfterUntil ?? now,
		);
		const waitMs = Math.max(0, availableAt - now);
		if (delayMs > 0) {
			this.hostAvailableAt.set(host, Math.max(now, availableAt) + delayMs);
		}
		if (waitMs > 0) {
			await abortableSleep(waitMs, signal);
		}
	}
}

export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
	if (ms <= 0) {
		return Promise.resolve();
	}
	if (signal?.aborted) {
		return Promise.reject(signal.reason ?? new DOMException("Operation aborted", "AbortError"));
	}

	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			cleanup();
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			cleanup();
			reject(signal?.reason ?? new DOMException("Operation aborted", "AbortError"));
		};
		const cleanup = () => signal?.removeEventListener("abort", onAbort);
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}
