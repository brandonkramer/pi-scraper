/**
 * @fileoverview Tool-level regression coverage for web_crawl API-surface wiring.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScrapeResult } from "../../scrape/pipeline.js";
import { closeStorageDbs } from "../../storage/db.js";
import { getStoredResult } from "../../storage/results.js";
import type { ResultEnvelope } from "../../types.js";
import { webCrawlTool } from "../web-crawl.js";

let crawlRunCount = 0;

vi.mock("../../crawl/runner.js", () => ({
	runCrawl: vi.fn(async (seedUrl: string) => {
		const { createCrawlState, saveCrawlState } = await import(
			"../../crawl/state.js"
		);
		const { createJobManifest, writeJobManifest } = await import(
			"../../storage/jobs.js"
		);
		const crawlId = `crawl-api-surface-${++crawlRunCount}`;
		const state = createCrawlState(seedUrl, crawlId);
		state.visited = [seedUrl];
		state.results = [seedUrl];
		state.metadata = {
			...state.metadata!,
			status: "done",
			visitedCount: 1,
			frontierCount: 0,
			succeededCount: 1,
			failedCount: 0,
		};
		const statePath = await saveCrawlState(state);
		await writeJobManifest(
			createJobManifest({
				jobId: crawlId,
				jobType: "crawl",
				status: "done",
				params: { seedUrl },
			}),
		);
		return {
			crawlId,
			pages: [apiReferencePage(seedUrl)],
			visited: [seedUrl],
			statePath,
			metadata: state.metadata!,
		};
	}),
}));

const signal = new AbortController().signal;
let homeDir: string;
let originalHome: string | undefined;

beforeEach(async () => {
	homeDir = await mkdtemp(path.join(tmpdir(), "pi-scraper-crawl-surface-"));
	originalHome = process.env.HOME;
	process.env.HOME = homeDir;
});

afterEach(async () => {
	closeStorageDbs();
	if (originalHome === undefined) delete process.env.HOME;
	else process.env.HOME = originalHome;
	await rm(homeDir, { recursive: true, force: true });
});

describe("web_crawl api-surface extraction", () => {
	it("returns and stores API surface only when requested", async () => {
		const requested = await webCrawlTool.execute(
			"call",
			{
				action: "run",
				url: "https://docs.example.com/api/client",
				extract: "api-surface",
			},
			signal,
		);
		const requestedEnvelope = requested.details as ResultEnvelope<{
			apiSurface?: { modules: Array<{ functions: Array<{ name: string }> }> };
		}>;
		const requestedSurface = requestedEnvelope.data.apiSurface;

		expect(requestedSurface?.modules[0]?.functions[0]?.name).toBe(
			"fetchMetrics",
		);
		expect(requested.content[0]?.text).toContain("apiSurface: 1 module(s).");

		const stored = await getStoredResult<{
			apiSurface?: { modules: Array<{ functions: Array<{ name: string }> }> };
		}>(requestedEnvelope.responseId!);
		expect(stored.value.apiSurface?.modules[0]?.functions[0]?.name).toBe(
			"fetchMetrics",
		);

		const plain = await webCrawlTool.execute(
			"call",
			{ action: "run", url: "https://docs.example.com/api/client" },
			signal,
		);
		const plainEnvelope = plain.details as ResultEnvelope<{
			apiSurface?: unknown;
		}>;
		expect(plainEnvelope.data.apiSurface).toBeUndefined();
		expect(plain.content[0]?.text).not.toContain("apiSurface:");
	});
});

function apiReferencePage(url: string): ScrapeResult {
	return {
		url,
		finalUrl: url,
		status: 200,
		mode: "fast",
		format: "markdown",
		timing: { startedAt: "2026-01-01T00:00:00.000Z" },
		truncated: false,
		contentType: "text/markdown",
		data: {
			route: "html",
			extractionPath: ["fast"],
			title: "Client API",
			markdown:
				"# Client API\n\n## fetchMetrics()\nFetch metrics.\n\n```ts\nfetchMetrics(project: string): Promise<Metrics>\n```",
			text: "Client API fetchMetrics(project: string): Promise<Metrics>",
		},
	};
}
