/** @file Batch **tests** run.test module. */
import { describe, expect, it } from "vitest";

import type { FetchUrlResult } from "../../http/client.ts";
import { runBatchScrape } from "../run.ts";

function response(url: string, text: string): FetchUrlResult {
	return {
		url,
		finalUrl: url,
		status: 200,
		headers: { "content-type": "text/html" },
		contentType: "text/html",
		text,
		downloadedBytes: text.length,
	};
}

function boomClient(boomUrl: string): { fetchUrl: (url: URL) => Promise<FetchUrlResult> } {
	return {
		fetchUrl: async (url) => {
			const value = url.toString();
			if (value.includes(boomUrl)) throw new Error("boom");
			return response(
				value,
				"<html><title>A</title><main>Hello world from A with enough content for extraction.</main></html>",
			);
		},
	};
}

function countingClient(counter: { fetches: number }): {
	fetchUrl: (url: URL) => Promise<FetchUrlResult>;
} {
	return {
		fetchUrl: async (url) => {
			counter.fetches += 1;
			return response(url.toString(), "<html><main>Hello duplicate URL.</main></html>");
		},
	};
}

function abortableClient(
	started: ReturnType<typeof deferred<void>>,
	aborted: ReturnType<typeof deferred<void>>,
): { fetchUrl: (url: URL, options?: unknown, signal?: AbortSignal) => Promise<never> } {
	return {
		fetchUrl: async (_url, _options, signal) => {
			started.resolve();
			signal?.addEventListener("abort", () => aborted.resolve(), { once: true });
			await aborted.promise;
			throw signal?.reason ?? new DOMException("Batch aborted", "AbortError");
		},
	};
}

describe("runBatchScrape", () => {
	it("keeps input order and reports per-item failures", async () => {
		const result = await runBatchScrape(
			["https://a.test/", "https://b.test/"],
			{},
			{
				httpClient: boomClient("b.test"),
			},
		);

		expect(result.items).toHaveLength(2);
		expect(result.items[0]?.ok).toBe(true);
		expect(result.items[1]?.ok).toBe(false);
		expect(result.summary).toContain("1 succeeded, 1 failed");
	});

	it("dedupes normalized URLs while preserving ordered items", async () => {
		const counter = { fetches: 0 };
		const result = await runBatchScrape(
			["https://a.test/?utm_source=x", "https://a.test/"],
			{},
			{
				httpClient: countingClient(counter),
			},
		);

		expect(counter.fetches).toBe(1);
		expect(result.items).toHaveLength(2);
		expect(result.items.every((item) => item.ok)).toBe(true);
	});

	it("propagates aborts to in-flight scrape work instead of silently completing", async () => {
		const controller = new AbortController();
		const started = deferred<void>();
		const aborted = deferred<void>();
		const run = runBatchScrape(
			["https://a.test/", "https://b.test/"],
			{ concurrency: 1 },
			{
				httpClient: abortableClient(started, aborted),
			},
			controller.signal,
		);

		await started.promise;
		controller.abort(new DOMException("Batch aborted", "AbortError"));
		await expect(run).rejects.toThrow(/aborted/iu);
		await aborted.promise;
	});
});

function deferred<T>(): { promise: Promise<T>; resolve: (value: T | PromiseLike<T>) => void } {
	let resolve!: (value: T | PromiseLike<T>) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
