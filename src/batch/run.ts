import { DEFAULT_CONCURRENCY } from "../defaults.js";
import { scrapeUrl, type ScrapePipelineDeps, type ScrapeResult } from "../scrape/pipeline.js";
import type { CommonScrapeOptions, StructuredError } from "../types.js";
import { storeResult, truncateAndStore, type StoreResultOptions } from "../storage/results.js";
import { normalizeUrl } from "../url/normalize.js";

export interface BatchProgress {
  state: "queued" | "processing" | "done" | "error";
  current: number;
  total: number;
  url?: string;
}

export interface BatchScrapeOptions extends CommonScrapeOptions, StoreResultOptions {
  concurrency?: number;
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
  const cache = new Map<string, Promise<{ ok: true; result: ScrapeResult } | { ok: false; error: StructuredError }>>();
  let next = 0;
  const concurrency = Math.max(1, Math.min(options.concurrency ?? DEFAULT_CONCURRENCY.global, urls.length || 1));

  options.onProgress?.({ state: "queued", current: 0, total: urls.length });
  async function worker(): Promise<void> {
    while (next < urls.length) {
      if (signal?.aborted) throw signal.reason ?? new DOMException("Batch aborted", "AbortError");
      const index = next++;
      const url = urls[index]!;
      options.onProgress?.({ state: "processing", current: index, total: urls.length, url });
      const item = await scrapeCached(url);
      items[index] = item.ok ? { ok: true, index, url, result: item.result } : { ok: false, index, url, error: item.error };
      options.onProgress?.({ state: item.ok ? "done" : "error", current: index + 1, total: urls.length, url });
    }
  }

  function scrapeCached(url: string): Promise<{ ok: true; result: ScrapeResult } | { ok: false; error: StructuredError }> {
    const key = safeCacheKey(url);
    const existing = cache.get(key);
    if (existing) return existing;
    const promise = scrapeItem(url);
    cache.set(key, promise);
    return promise;
  }

  async function scrapeItem(url: string): Promise<{ ok: true; result: ScrapeResult } | { ok: false; error: StructuredError }> {
    try {
      const result = await scrapeUrl(url, options, deps, signal);
      return result.error ? { ok: false, error: result.error } : { ok: true, result };
    } catch (error) {
      return { ok: false, error: toStructuredError(error, url) };
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const completed = items.filter(Boolean) as BatchItemResult[];
  const summary = summarize(completed);
  if (options.storeFullResults === true) {
    const metadata = await storeResult(completed, options);
    return { items: completed, responseId: metadata.responseId, fullOutputPath: metadata.fullOutputPath, truncated: false, summary };
  }
  const truncated = await truncateAndStore(summary, completed, options);
  return { items: completed, responseId: truncated.metadata?.responseId, fullOutputPath: truncated.metadata?.fullOutputPath, truncated: truncated.truncated, summary: truncated.text };
}

function summarize(items: readonly BatchItemResult[]): string {
  const ok = items.filter((item) => item.ok).length;
  const failed = items.length - ok;
  return `Batch scrape complete: ${ok} succeeded, ${failed} failed, ${items.length} total.`;
}

function safeCacheKey(url: string): string {
  try { return normalizeUrl(url); } catch { return url; }
}

function toStructuredError(error: unknown, url: string): StructuredError {
  if (typeof error === "object" && error !== null && "structured" in error) {
    return (error as { structured: StructuredError }).structured;
  }
  return { code: "BATCH_ITEM_FAILED", phase: "batch", message: error instanceof Error ? error.message : "Batch item failed", retryable: false, url };
}
