/** @file Crawl **tests** runner.test module. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { FetchUrlResult } from "../../http/client.ts";
import { runCrawl } from "../runner.ts";
import { loadCrawlMetadata, loadCrawlState } from "../state.ts";

let rootDir: string;

beforeEach(async () => {
	rootDir = await mkdtemp(path.join(tmpdir(), "pi-scraper-runner-"));
});

afterEach(async () => {
	await rm(rootDir, { recursive: true, force: true });
});

function html(url: string, body: string): FetchUrlResult {
	return {
		url,
		finalUrl: url,
		status: 200,
		headers: { "content-type": "text/html" },
		contentType: "text/html",
		text: body,
		downloadedBytes: body.length,
	};
}

interface CrawlTestDeps {
	httpClient: { fetchUrl(url: URL): Promise<FetchUrlResult> };
}

function globalConcurrencyScenario(): { deps: CrawlTestDeps; maxActive: () => number } {
	let active = 0;
	let maxActive = 0;
	let firstStarted = false;
	let releaseFirst: (() => void) | undefined;
	const firstRelease = new Promise<void>((resolve) => {
		releaseFirst = resolve;
	});
	return {
		deps: {
			httpClient: {
				fetchUrl: async (url) => {
					const value = url.toString();
					if (value === "https://example.com/") {
						return html(
							value,
							`<html><main>Seed</main><a href="https://example.com/a">A</a><a href="https://example.com/b">B</a><a href="https://example.com/c">C</a><a href="https://example.com/d">D</a></html>`,
						);
					}
					active += 1;
					maxActive = Math.max(maxActive, active);
					if (!firstStarted) {
						firstStarted = true;
						await Promise.race([firstRelease, sleep(200)]);
					} else {
						releaseFirst?.();
						await sleep(5);
					}
					active -= 1;
					return html(value, `<html><main>${value}</main></html>`);
				},
			},
		},
		maxActive: () => maxActive,
	};
}

function perHostConcurrencyScenario(): {
	deps: CrawlTestDeps;
	maxGlobal: () => number;
	maxForHost: (host: string) => number | undefined;
} {
	const activeByHost = new Map<string, number>();
	const maxByHost = new Map<string, number>();
	let maxGlobal = 0;
	let heldHost: string | undefined;
	let releaseHeld: (() => void) | undefined;
	const heldRelease = new Promise<void>((resolve) => {
		releaseHeld = resolve;
	});
	return {
		deps: {
			httpClient: {
				fetchUrl: async (url) => {
					const value = url.toString();
					if (value === "https://example.com/") {
						return html(
							value,
							`<html><main>Seed</main><a href="https://a.test/1">A1</a><a href="https://a.test/2">A2</a><a href="https://b.test/1">B1</a><a href="https://b.test/2">B2</a></html>`,
						);
					}
					const host = new URL(value).host;
					activeByHost.set(host, hostCount(activeByHost, host, 0) + 1);
					maxByHost.set(
						host,
						Math.max(hostCount(maxByHost, host, 0), hostCount(activeByHost, host, 0)),
					);
					maxGlobal = Math.max(
						maxGlobal,
						[...activeByHost.values()].reduce((sum, count) => sum + count, 0),
					);
					if (!heldHost) {
						heldHost = host;
						await Promise.race([heldRelease, sleep(200)]);
					} else if (host !== heldHost) {
						releaseHeld?.();
						await sleep(5);
					} else {
						await sleep(30);
					}
					activeByHost.set(host, hostCount(activeByHost, host, 1) - 1);
					return html(value, `<html><main>${value}</main></html>`);
				},
			},
		},
		maxGlobal: () => maxGlobal,
		maxForHost: (host) => maxByHost.get(host),
	};
}

function hostCount(map: Map<string, number>, host: string, fallback: number): number {
	return map.get(host) ?? fallback;
}

function recordProgress(progress: string[]): (update: { message?: string }) => void {
	return (update) => progress.push(update.message ?? "");
}

describe("runCrawl", () => {
	it("crawls breadth-first basics through shared scrape pipeline", async () => {
		const result = await runCrawl(
			"https://example.com",
			{ rootDir, crawlId: "c1", maxPages: 2, maxDepth: 1 },
			{
				httpClient: {
					fetchUrl: async (url) =>
						html(
							url.toString(),
							`<html><main>Page ${url}</main><a href="https://example.com/a">A</a><a href="https://other.com/x">X</a></html>`,
						),
				},
			},
		);

		expect(result.crawlId).toBe("c1");
		expect(result.pages).toHaveLength(2);
		expect(result.visited).toContain("https://example.com/a");
		expect(result.statePath).toContain("c1");
		expect(result.metadata.status).toBe("done");
		expect(result.metadata.succeededCount).toBe(2);
		expect(result.metadata.frontierCount).toBe(0);
	});

	it("processes discovered pages concurrently up to the global limit", async () => {
		const scenario = globalConcurrencyScenario();
		const result = await runCrawl(
			"https://example.com",
			{ rootDir, crawlId: "global", maxPages: 5, maxDepth: 1, concurrency: 2 },
			scenario.deps,
		);

		expect(result.pages).toHaveLength(5);
		expect(scenario.maxActive()).toBeGreaterThan(1);
		expect(scenario.maxActive()).toBeLessThanOrEqual(2);
	});

	it("respects per-host crawl concurrency while allowing other hosts", async () => {
		const scenario = perHostConcurrencyScenario();
		const result = await runCrawl(
			"https://example.com",
			{
				rootDir,
				crawlId: "per-host",
				maxPages: 5,
				maxDepth: 1,
				sameOrigin: false,
				concurrency: 4,
				perHostConcurrency: 1,
			},
			scenario.deps,
		);

		expect(result.pages).toHaveLength(5);
		expect(scenario.maxGlobal()).toBeGreaterThan(1);
		expect(scenario.maxForHost("a.test")).toBe(1);
		expect(scenario.maxForHost("b.test")).toBe(1);
	});

	it("resumes from saved frontier state", async () => {
		const first = await runCrawl(
			"https://example.com",
			{ rootDir, crawlId: "resume", maxPages: 1, maxDepth: 1 },
			{
				httpClient: {
					fetchUrl: async (url) =>
						html(
							url.toString(),
							`<html><main>Seed</main><a href="https://example.com/a">A</a></html>`,
						),
				},
			},
		);
		expect(first.pages).toHaveLength(1);
		expect((await loadCrawlState("resume", { rootDir })).frontier[0]?.url).toBe(
			"https://example.com/a",
		);

		const second = await runCrawl(
			"https://example.com",
			{ rootDir, crawlId: "resume", maxPages: 1, maxDepth: 1, resume: true },
			{
				httpClient: {
					fetchUrl: async (url) => html(url.toString(), `<html><main>${url}</main></html>`),
				},
			},
		);
		expect(second.pages[0]?.url).toBe("https://example.com/a");
	});

	it("persists crawl metadata and emits compact status progress", async () => {
		const progress: string[] = [];
		const result = await runCrawl(
			"https://example.com",
			{
				rootDir,
				crawlId: "meta",
				maxPages: 2,
				maxDepth: 1,
				onProgress: recordProgress(progress),
			},
			{
				httpClient: {
					fetchUrl: async (url) =>
						html(
							url.toString(),
							`<html><main>Page ${url}</main><a href="https://example.com/a">A</a></html>`,
						),
				},
			},
		);

		const metadata = await loadCrawlMetadata("meta", { rootDir });
		expect(metadata.status).toBe("done");
		expect(metadata.succeededCount).toBe(2);
		expect(metadata.failedCount).toBe(0);
		expect(metadata.visitedCount).toBeGreaterThanOrEqual(2);
		expect(metadata.maxDepthVisited).toBe(1);
		expect(result.metadata).toMatchObject({
			status: "done",
			succeededCount: 2,
		});
		expect(progress.some((message) => message.includes("2/2 pages"))).toBe(true);
	});

	it("can restart a crawlId when resume is false", async () => {
		await runCrawl(
			"https://example.com",
			{ rootDir, crawlId: "restart", maxPages: 1, maxDepth: 1 },
			{
				httpClient: {
					fetchUrl: async (url) =>
						html(
							url.toString(),
							`<html><main>Seed</main><a href="https://example.com/a">A</a></html>`,
						),
				},
			},
		);

		const restarted = await runCrawl(
			"https://example.com/other",
			{ rootDir, crawlId: "restart", maxPages: 1, maxDepth: 1, resume: false },
			{
				httpClient: {
					fetchUrl: async (url) => html(url.toString(), `<html><main>${url}</main></html>`),
				},
			},
		);

		expect(restarted.pages[0]?.url).toBe("https://example.com/other");
		expect((await loadCrawlState("restart", { rootDir })).seedUrl).toBe(
			"https://example.com/other",
		);
	});
});

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}
