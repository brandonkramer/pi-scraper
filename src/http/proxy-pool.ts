/**
 * @file Proxy-rotation pool with health tracking and cooldown. Supports single proxy URL and
 *   round-robin rotation across an array of URLs with automatic cooldown on failures.
 */
import { ProxyAgent } from "undici";

const DEFAULT_COOLDOWN_MS = 60_000;
const MAX_CONSECUTIVE_FAILURES = 3;

interface ProxyEntry {
	url: string;
	healthy: boolean;
	cooldownUntil: number;
	consecutiveFailures: number;
	totalFailures: number;
	totalRequests: number;
}

export class ProxyPool {
	private readonly entries: ProxyEntry[] = [];
	private currentIndex = 0;

	constructor(
		proxyUrls: string | string[],
		private readonly cooldownMs = DEFAULT_COOLDOWN_MS,
	) {
		const urls = Array.isArray(proxyUrls) ? proxyUrls : [proxyUrls];
		for (const url of urls) {
			this.entries.push({
				url,
				healthy: true,
				cooldownUntil: 0,
				consecutiveFailures: 0,
				totalFailures: 0,
				totalRequests: 0,
			});
		}
	}

	/** Return the next healthy proxy URL, or undefined if all are in cooldown. */
	acquire(): string | undefined {
		const now = Date.now();
		for (let attempt = 0; attempt < this.entries.length; attempt++) {
			const entry = this.entries[this.currentIndex % this.entries.length];
			this.currentIndex = (this.currentIndex + 1) % this.entries.length;
			if (now >= entry.cooldownUntil) {
				entry.totalRequests += 1;
				return entry.url;
			}
		}
		return undefined;
	}

	/** Report proxy status after a request. */
	release(proxyUrl: string, success: boolean): void {
		const entry = this.entries.find((e) => e.url === proxyUrl);
		if (!entry) return;
		if (success) {
			entry.consecutiveFailures = 0;
			entry.healthy = true;
		} else {
			entry.consecutiveFailures += 1;
			entry.totalFailures += 1;
			entry.cooldownUntil = Date.now() + this.cooldownMs;
			if (entry.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
				entry.healthy = false;
			}
		}
	}

	/** Create an undici ProxyAgent for the given proxy URL. */
	createAgent(proxyUrl: string): ProxyAgent {
		return new ProxyAgent(proxyUrl);
	}

	/** Return health summary for diagnostics. */
	diagnostics(): Array<{
		url: string;
		healthy: boolean;
		cooldownRemainingMs: number;
		consecutiveFailures: number;
		totalRequests: number;
		totalFailures: number;
	}> {
		const now = Date.now();
		return this.entries.map((e) => ({
			url: e.url,
			healthy: e.healthy,
			cooldownRemainingMs: Math.max(0, e.cooldownUntil - now),
			consecutiveFailures: e.consecutiveFailures,
			totalRequests: e.totalRequests,
			totalFailures: e.totalFailures,
		}));
	}

	get size(): number {
		return this.entries.length;
	}
}

export function createProxyPool(proxy: string | string[]): ProxyPool {
	return new ProxyPool(proxy);
}

/**
 * Resolve a proxy parameter to a single proxy URL. Arrays are rotated round-robin via a global
 * ProxyPool. Single strings are returned as-is. Used at the tool boundary before passing options to
 * the scrape pipeline.
 */
const globalPools = new Map<string, ProxyPool>();

export function resolveProxyParam(proxy: string | string[] | undefined): string | undefined {
	if (!proxy) return undefined;
	if (typeof proxy === "string") return proxy;
	const key = proxy.toSorted().join("|");
	let pool = globalPools.get(key);
	if (!pool) {
		pool = new ProxyPool(proxy);
		globalPools.set(key, pool);
	}
	return pool.acquire();
}
