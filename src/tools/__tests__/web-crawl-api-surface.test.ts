/**
 * @fileoverview Tool-level regression coverage for web_crawl API-surface wiring.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScrapeResult } from "../../scrape/pipeline.ts";
import { closeStorageDbs } from "../../storage/db/open.ts";
import { readResponse } from "../../storage/responses/read.ts";
import type { ResultEnvelope } from "../../types.ts";
import { webCrawlTool } from "../web-crawl.ts";
import { webGetResultTool } from "../web-get-result.ts";

let crawlRunCount = 0;

vi.mock("../../crawl/runner.ts", () => ({
	runCrawl: vi.fn(async (seedUrl: string) => {
		const { createCrawlState, saveCrawlState } = await import(
			"../../crawl/state.ts"
		);
		const { createJobManifest, writeJobManifest } = await import(
			"../../storage/jobs/manifest.ts"
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
	it("stores a crawl context package when compile is requested", async () => {
		const result = await webCrawlTool.execute(
			"call",
			{
				action: "run",
				url: "https://docs.example.com/api/client",
				compile: true,
			},
			signal,
		);
		const envelope = result.details as ResultEnvelope<{
			contextPackage?: {
				package: { source: string; crawlId?: string; urlCount: number };
				tree: Array<{ url: string; breadcrumbs?: string[]; excerpt?: string }>;
			};
		}>;
		const diagnostics = envelope.diagnostics as {
			contextPackage?: { responseId: string; crawlPackagePath: string };
		};

		expect(result.content[0]?.text).toContain("package: 1 page(s)");
		expect(envelope.data.contextPackage?.package.source).toBe("crawl");
		expect(envelope.data.contextPackage?.package.urlCount).toBe(1);
		expect(envelope.data.contextPackage?.tree[0]?.breadcrumbs).toContain(
			"docs.example.com",
		);
		expect(envelope.data.contextPackage?.tree[0]?.excerpt).toContain(
			"fetchMetrics",
		);

		const stored = await readResponse<{
			package: { source: string; crawlId?: string };
			tree: Array<{ title?: string }>;
		}>(diagnostics.contextPackage!.responseId);
		expect(stored.value.package.source).toBe("crawl");
		expect(stored.value.tree[0]?.title).toBe("Client API");

		const fetched = await webGetResultTool.execute(
			"call",
			{ responseId: diagnostics.contextPackage!.responseId },
			signal,
		);
		expect((fetched.details as ResultEnvelope).data).toMatchObject({
			package: { source: "crawl" },
		});

		const crawlFile = JSON.parse(
			await readFile(diagnostics.contextPackage!.crawlPackagePath, "utf8"),
		) as { package: { source: string } };
		expect(crawlFile.package.source).toBe("crawl");
	});

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

		const stored = await readResponse<{
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
