/**
 * @fileoverview batch run module.
 */
import { randomUUID } from "node:crypto";
import { DEFAULT_CONCURRENCY } from "../defaults.js";
import { createHttpClient } from "../http/client.js";
import {
	scrapeUrl,
	type ScrapePipelineDeps,
	type ScrapeResult,
} from "../scrape/pipeline.js";
import { isAbortError, resultChars } from "../scrape/_utils.js";
import { hasStructuredError } from "../http/retry.js";
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
import {
	storeResult,
	truncateAndStore,
	type StoreResultOptions,
} from "../storage/results.js";
import { normalizeMaybe } from "../storage/_fields.js";

export interface BatchProgress {
	state: "queued" | "processing" | "done" | "error";
	current: number;
	total: number;
	url?: string;
}

export interface BatchScrapeOptions
	extends CommonScrapeOptions,
		StoreResultOptions {
	concurrency?: number;
	perHostConcurrency?: number;
	storeFullResults?: boolean;
	onProgress?: (progress: BatchProgress) => void;
}

export interface BatchItemSuccess {
	ok: true;
	index: number;
	url: string;
	result: ScrapeResult;
}

export interface BatchItemFailure {
	ok: false;
	index: number;
	url: string;
	error: StructuredError;
}

export type BatchItemResult = BatchItemSuccess | BatchItemFailure;

export interface BatchScrapeResult {
	items: BatchItemResult[];
	responseId?: string;
	fullOutputPath?: string;
	jobId: string;
	jobManifestPath?: string;
	truncated: boolean;
	summary: string;
}

export async function runBatchScrape(
	urls: readonly string[],
	options: BatchScrapeOptions = {},
	deps: ScrapePipelineDeps = {},
	signal?: AbortSignal,
): Promise<BatchScrapeResult> {
	const items = new Array<BatchItemResult>(urls.length);
	const jobId = randomUUID();
	let errors: JobError[] = [];
	let totalBytes = 0;
	let totalChars = 0;
	let truncatedPages = 0;
	let jobManifestPath = await writeJobManifest(
		createJobManifest({
			jobId,
			jobType: "batch",
			params: { urls, ...options },
			mode: options.mode,
			format: options.format,
		}),
		options,
	);
	let manifestChain: Promise<void> = Promise.resolve();
	const cache = new Map<
		string,
		Promise<
			{ ok: true; result: ScrapeResult } | { ok: false; error: StructuredError }
		>
	>();
	let next = 0;
	const concurrency = Math.max(
		1,
		Math.min(
			options.concurrency ?? DEFAULT_CONCURRENCY.global,
			urls.length || 1,
		),
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

	options.onProgress?.({ state: "queued", current: 0, total: urls.length });
	await updateBatchJob("running", 0, 0);
	async function worker(): Promise<void> {
		while (next < urls.length) {
			if (signal?.aborted)
				throw signal.reason ?? new DOMException("Batch aborted", "AbortError");
			const index = next++;
			const url = urls[index]!;
			options.onProgress?.({
				state: "processing",
				current: index,
				total: urls.length,
				url,
			});
			const item = await scrapeCached(url);
			items[index] = item.ok
				? { ok: true, index, url, result: item.result }
				: { ok: false, index, url, error: item.error };
			if (item.ok) {
				totalBytes += item.result.downloadedBytes ?? 0;
				totalChars += resultChars(item.result);
				if (item.result.truncated) truncatedPages += 1;
			} else {
				errors = appendJobError(errors, structuredErrorToJobError(item.error));
			}
			await updateBatchJob(
				"running",
				items.filter(Boolean).length,
				errors.length,
			);
			options.onProgress?.({
				state: item.ok ? "done" : "error",
				current: index + 1,
				total: urls.length,
				url,
			});
		}
	}

	function scrapeCached(
		url: string,
	): Promise<
		{ ok: true; result: ScrapeResult } | { ok: false; error: StructuredError }
	> {
		const key = normalizeMaybe(url);
		const existing = cache.get(key);
		if (existing) return existing;
		const promise = scrapeItem(url);
		cache.set(key, promise);
		return promise;
	}

	async function scrapeItem(
		url: string,
	): Promise<
		{ ok: true; result: ScrapeResult } | { ok: false; error: StructuredError }
	> {
		try {
			const result = await scrapeUrl(url, options, sharedDeps, signal);
			return result.error
				? { ok: false, error: result.error }
				: { ok: true, result };
		} catch (error) {
			return { ok: false, error: toStructuredError(error, url) };
		}
	}

	try {
		await Promise.all(Array.from({ length: concurrency }, () => worker()));
	} catch (error) {
		errors = appendJobError(errors, unknownToJobError(error, "batch"));
		await updateBatchJob(
			isAbortError(error, signal) ? "paused" : "error",
			items.filter(Boolean).length,
			errors.length,
		);
		throw error;
	}
	const completed = items.filter(Boolean) as BatchItemResult[];
	const summary = summarize(completed);
	if (options.storeFullResults === true) {
		const metadata = await storeResult(completed, options);
		await updateBatchJob("done", completed.length, errors.length, [
			metadata.responseId,
		]);
		return {
			items: completed,
			responseId: metadata.responseId,
			fullOutputPath: metadata.fullOutputPath,
			jobId,
			jobManifestPath,
			truncated: false,
			summary,
		};
	}
	const truncated = await truncateAndStore(summary, completed, options);
	await updateBatchJob(
		"done",
		completed.length,
		errors.length,
		truncated.metadata?.responseId
			? [truncated.metadata.responseId]
			: undefined,
	);
	return {
		items: completed,
		responseId: truncated.metadata?.responseId,
		fullOutputPath: truncated.metadata?.fullOutputPath,
		jobId,
		jobManifestPath,
		truncated: truncated.truncated,
		summary: truncated.text,
	};

	async function updateBatchJob(
		status: "running" | "done" | "error" | "paused",
		urlsProcessed: number,
		urlsFailed: number,
		responseIds?: string[],
	): Promise<void> {
		manifestChain = manifestChain
			.catch(() => undefined)
			.then(async () => {
				const updated = await updateJobManifest(
					jobId,
					{
						status,
						startedAt: new Date().toISOString(),
						completedAt:
							status === "running" ? undefined : new Date().toISOString(),
						urlsProcessed,
						urlsFailed,
						errors,
						totalBytes,
						totalChars,
						truncatedPages,
						responseIds,
					},
					options,
				);
				jobManifestPath = updated.path;
			});
		await manifestChain;
	}
}

function summarize(items: readonly BatchItemResult[]): string {
	const ok = items.filter((item) => item.ok).length;
	const failed = items.length - ok;
	return `Batch scrape complete: ${ok} succeeded, ${failed} failed, ${items.length} total.`;
}

function toStructuredError(error: unknown, url: string): StructuredError {
	if (hasStructuredError(error)) return error.structured;
	return {
		code: "BATCH_ITEM_FAILED",
		phase: "batch",
		message: error instanceof Error ? error.message : "Batch item failed",
		retryable: false,
		url,
	};
}
