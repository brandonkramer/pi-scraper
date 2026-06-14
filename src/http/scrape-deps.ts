/** @file Shared httpClient deps construction for the batch + crawl schedulers. */
import { DEFAULT_CONCURRENCY } from "../defaults.ts";
import type { ScrapePipelineDeps } from "../scrape/pipeline.ts";
import { createHttpClient } from "./client.ts";

/**
 * Ensure deps carry an httpClient, building a pooled one when absent. Shared by `runBatchScrape`
 * and `runCrawl` so the pool-construction lives in one place. Injected deps (tests) pass through.
 */
export function ensureHttpClientDeps<D extends ScrapePipelineDeps>(
	deps: D,
	options: { concurrency: number; perHostConcurrency?: number; retryAttempts?: number },
): D {
	if (deps.httpClient) return deps;
	return {
		...deps,
		httpClient: createHttpClient({
			globalConcurrency: options.concurrency,
			perHostConcurrency: options.perHostConcurrency ?? DEFAULT_CONCURRENCY.perHost,
			retryAttempts: options.retryAttempts,
		}),
	};
}
