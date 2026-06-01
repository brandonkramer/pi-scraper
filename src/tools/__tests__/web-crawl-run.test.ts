/** @file Tools **tests** web-crawl-run.test module. */
import { describe, expect, it, vi } from "vitest";

import { runCrawl } from "../../crawl/runner.ts";
import { crawlRun } from "../web-crawl-run.ts";

vi.mock("../../crawl/runner.ts", async () => {
	const actual = await vi.importActual("../../crawl/runner.ts");
	return {
		...(actual as object),
		runCrawl: vi.fn(async () => ({
			pages: [],
			metadata: {
				status: "done",
				visitedCount: 0,
				succeededCount: 0,
				failedCount: 0,
				maxDepthVisited: 0,
			},
			crawlId: "test-crawl",
		})),
	};
});

vi.mock("../../crawl/state.ts", async () => {
	const actual = await vi.importActual("../../crawl/state.ts");
	return {
		...(actual as object),
		updateCrawlMetadata: vi.fn(async (_crawlId: string, patch: unknown) => patch),
	};
});

vi.mock("../../storage/responses/store.ts", async () => {
	return {
		storeResponseWithId: vi.fn(async (factory: (id: string) => unknown) => ({
			value: factory("resp-id"),
			metadata: { responseId: "resp-id", storedAt: "2026-01-01T00:00:00Z", storedBytes: 0 },
		})),
	};
});

vi.mock("../../storage/context/build.ts", async () => {
	return {
		storeCompiledContext: vi.fn(async () => ({ responseId: "ctx-id", storedBytes: 0 })),
	};
});

vi.mock("../../storage/jobs/manifest.ts", async () => {
	return {
		updateJobManifest: vi.fn(async () => ({
			manifest: { jobId: "test-crawl", status: "done" },
			path: "/tmp/test-crawl.json",
		})),
	};
});

vi.mock("../../config.ts", async () => {
	return {
		loadEffectiveConfig: vi.fn(async () => ({
			scrapeDefaults: {},
			scrapeMode: "fast",
			outputFormat: "markdown",
		})),
	};
});

const signal = new AbortController().signal;

describe("crawlRun proxy integration", () => {
	it("passes a resolveProxy resolver when proxy is an array", async () => {
		const mockRunCrawl = vi.mocked(runCrawl);
		mockRunCrawl.mockClear();

		await crawlRun(
			{
				url: "https://example.com",
				maxPages: 1,
				proxy: ["http://a:8080", "http://b:8080"],
			},
			signal,
		);

		expect(mockRunCrawl).toHaveBeenCalledTimes(1);
		const options = mockRunCrawl.mock.calls[0]?.[1];
		expect(options).toBeDefined();
		expect(options?.proxy).toBeUndefined();
		expect(typeof options?.resolveProxy).toBe("function");
	});

	it("passes a single proxy string directly when proxy is a string", async () => {
		const mockRunCrawl = vi.mocked(runCrawl);
		mockRunCrawl.mockClear();

		await crawlRun(
			{
				url: "https://example.com",
				maxPages: 1,
				proxy: "http://a:8080",
			},
			signal,
		);

		expect(mockRunCrawl).toHaveBeenCalledTimes(1);
		const options = mockRunCrawl.mock.calls[0]?.[1];
		expect(options?.proxy).toBe("http://a:8080");
		expect(options?.resolveProxy).toBeUndefined();
	});

	it("passes neither proxy nor resolveProxy when proxy is omitted", async () => {
		const mockRunCrawl = vi.mocked(runCrawl);
		mockRunCrawl.mockClear();

		await crawlRun(
			{
				url: "https://example.com",
				maxPages: 1,
			},
			signal,
		);

		expect(mockRunCrawl).toHaveBeenCalledTimes(1);
		const options = mockRunCrawl.mock.calls[0]?.[1];
		expect(options?.proxy).toBeUndefined();
		expect(options?.resolveProxy).toBeUndefined();
	});
});
