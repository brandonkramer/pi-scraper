import { DEFAULT_CONCURRENCY } from "../defaults.js";

export interface PolitenessOptions {
	globalConcurrency?: number;
	perHostConcurrency?: number;
	minDelayMs?: number;
}

type Release = () => void;

class Semaphore {
	private active = 0;
	private readonly queue: Array<() => void> = [];
	private queueHead = 0;

	constructor(private readonly limit: number) {}

	async acquire(signal?: AbortSignal): Promise<Release> {
		if (signal?.aborted) {
			throw (
				signal.reason ?? new DOMException("Operation aborted", "AbortError")
			);
		}

		if (this.active < this.limit) {
			this.active += 1;
			return () => this.release();
		}

		return new Promise<Release>((resolve, reject) => {
			const run = () => {
				cleanup();
				this.active += 1;
				resolve(() => this.release());
			};
			const onAbort = () => {
				cleanup();
				const index = this.queue.indexOf(run);
				if (index >= this.queueHead) {
					this.queue.splice(index, 1);
				}
				reject(
					signal?.reason ?? new DOMException("Operation aborted", "AbortError"),
				);
			};
			const cleanup = () => signal?.removeEventListener("abort", onAbort);

			this.queue.push(run);
			signal?.addEventListener("abort", onAbort, { once: true });
		});
	}

	private release(): void {
		this.active = Math.max(0, this.active - 1);
		const next = this.queue[this.queueHead];
		if (next) {
			this.queueHead += 1;
			this.compactQueue();
			queueMicrotask(next);
		}
	}

	private compactQueue(): void {
		const consumed = this.queueHead;
		if (consumed < 1024 || consumed <= this.queue.length - consumed) return;
		this.queue.splice(0, consumed);
		this.queueHead = 0;
	}
}

export class PolitenessController {
	private readonly globalSemaphore: Semaphore;
	private readonly hostSemaphores = new Map<string, Semaphore>();
	private readonly hostAvailableAt = new Map<string, number>();

	constructor(private readonly options: PolitenessOptions = {}) {
		this.globalSemaphore = new Semaphore(
			options.globalConcurrency ?? DEFAULT_CONCURRENCY.global,
		);
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

	private hostSemaphore(host: string): Semaphore {
		const existing = this.hostSemaphores.get(host);
		if (existing) {
			return existing;
		}
		const created = new Semaphore(
			this.options.perHostConcurrency ?? DEFAULT_CONCURRENCY.perHost,
		);
		this.hostSemaphores.set(host, created);
		return created;
	}

	private async waitTurn(
		host: string,
		crawlDelayMs?: number,
		signal?: AbortSignal,
	): Promise<void> {
		const delayMs = Math.max(this.options.minDelayMs ?? 0, crawlDelayMs ?? 0);
		if (delayMs <= 0) {
			return;
		}

		const now = Date.now();
		const availableAt = this.hostAvailableAt.get(host) ?? now;
		const waitMs = Math.max(0, availableAt - now);
		this.hostAvailableAt.set(host, Math.max(now, availableAt) + delayMs);
		if (waitMs > 0) {
			await abortableSleep(waitMs, signal);
		}
	}
}

export function abortableSleep(
	ms: number,
	signal?: AbortSignal,
): Promise<void> {
	if (ms <= 0) {
		return Promise.resolve();
	}
	if (signal?.aborted) {
		return Promise.reject(
			signal.reason ?? new DOMException("Operation aborted", "AbortError"),
		);
	}

	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			cleanup();
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			cleanup();
			reject(
				signal?.reason ?? new DOMException("Operation aborted", "AbortError"),
			);
		};
		const cleanup = () => signal?.removeEventListener("abort", onAbort);
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}
