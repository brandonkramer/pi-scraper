/** @file Incremental batch progress accounting tests. */
import { describe, expect, it } from "vitest";

import {
	type BatchProgressView,
	updateIndexedBatchProgress,
	updateUrlBatchProgress,
} from "../progress-state.ts";

function queuedProgress(urls: string[]): BatchProgressView {
	return {
		total: urls.length,
		completed: 0,
		succeeded: 0,
		failed: 0,
		concurrency: 2,
		items: urls.map((url) => ({ url, status: "queued" })),
	};
}

describe("incremental batch progress", () => {
	it("updates indexed counts across repeated and changed terminal states", () => {
		const progress = queuedProgress(["https://example.test/a", "https://example.test/b"]);

		updateIndexedBatchProgress(progress, "processing", 0);
		updateIndexedBatchProgress(progress, "done", 1);
		updateIndexedBatchProgress(progress, "done", 1);
		updateIndexedBatchProgress(progress, "error", 2);

		expect(progress).toMatchObject({ completed: 2, succeeded: 1, failed: 1 });

		updateIndexedBatchProgress(progress, "error", 1);
		expect(progress).toMatchObject({ completed: 2, succeeded: 0, failed: 2 });
	});

	it("accounts for dynamically discovered crawl URLs without recounting existing items", () => {
		const firstUrl = "https://example.test/a";
		const secondUrl = "https://example.test/b";
		const progress = queuedProgress([firstUrl]);

		updateUrlBatchProgress(progress, "processing", firstUrl);
		updateUrlBatchProgress(progress, "done", firstUrl);
		updateUrlBatchProgress(progress, "error", secondUrl);
		expect(progress).toMatchObject({ total: 2, completed: 2, succeeded: 1, failed: 1 });

		updateUrlBatchProgress(progress, "done", secondUrl);
		expect(progress).toMatchObject({ total: 2, completed: 2, succeeded: 2, failed: 0 });
	});
});
