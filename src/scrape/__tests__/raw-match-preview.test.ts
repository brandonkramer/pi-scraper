/** @file Raw line-match preview regression tests for web_scrape and web_batch. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BatchScrapeResult } from "../../batch/run.ts";
import { closeStorageDbs } from "../../storage/db/open.ts";
import type { ToolContext } from "../../types.ts";
import type { ScrapeResult } from "../pipeline.ts";

const scrapePipelineMock = vi.hoisted(() => ({
	scrapeUrl: vi.fn(),
}));
const batchRunMock = vi.hoisted(() => ({
	runBatchScrape: vi.fn(),
}));

vi.mock("../pipeline.ts", () => ({
	scrapeUrl: scrapePipelineMock.scrapeUrl,
}));

vi.mock("../../batch/run.ts", () => ({
	runBatchScrape: batchRunMock.runBatchScrape,
}));

const { createWebScrapeTool } = await import("../../tools/web-scrape.ts");
const { webBatchTool } = await import("../../tools/web-batch.ts");

const signal = new AbortController().signal;
let homeDir: string;
let originalHome: string | undefined;

beforeEach(async () => {
	homeDir = await mkdtemp(join(tmpdir(), "pi-scraper-raw-preview-"));
	originalHome = process.env.HOME;
	process.env.HOME = homeDir;
	scrapePipelineMock.scrapeUrl.mockReset();
	batchRunMock.runBatchScrape.mockReset();
});

afterEach(async () => {
	closeStorageDbs();
	if (originalHome === undefined) delete process.env.HOME;
	else process.env.HOME = originalHome;
	await rm(homeDir, { recursive: true, force: true });
});

describe("raw line-match previews", () => {
	it("prioritizes matching raw snippets in web_scrape text and answer context", async () => {
		const rawText = [
			"intro prefix that should not become the inline preview",
			"before target context",
			"export const targetNeedle = true;",
			"after target context",
		].join("\n");
		scrapePipelineMock.scrapeUrl.mockResolvedValue(
			rawScrape("https://example.com/file.ts", rawText),
		);

		const result = await createWebScrapeTool().execute(
			"call",
			{
				url: "https://example.com/file.ts",
				format: "raw",
				linesMatching: ["targetNeedle"],
				contextLines: 1,
			},
			signal,
		);
		const text = result.content[0]?.text ?? "";
		const envelope = result.details as ToolContext<{ matches?: unknown[] }>;

		expect(text).toContain("Matching line snippets (1 match):");
		expect(text).toContain('needle "targetNeedle" at line 3');
		expect(text).toContain("  2: before target context");
		expect(text).toContain("> 3: export const targetNeedle = true;");
		expect(text).toContain("  4: after target context");
		expect(text).not.toContain("intro prefix that should not become the inline preview");
		expect(envelope.answerContext).toContain("> 3: export const targetNeedle = true;");
		expect(envelope.data?.matches).toHaveLength(1);
	});

	it("groups web_batch matching snippets by URL-derived labels", async () => {
		const rawText = ["alpha header", "beta targetNeedle", "gamma footer"].join("\n");
		batchRunMock.runBatchScrape.mockResolvedValue({
			items: [
				{
					ok: true,
					index: 0,
					url: "https://example.com/src/file.ts",
					result: rawScrape("https://example.com/src/file.ts", rawText),
				},
			],
			jobId: "batch-raw-preview",
			truncated: false,
			summary: "Batch scrape complete: 1 succeeded, 0 failed, 1 total.",
		} satisfies BatchScrapeResult);

		const result = await webBatchTool.execute(
			"call",
			{
				urls: ["https://example.com/src/file.ts"],
				format: "raw",
				linesMatching: ["targetNeedle"],
				contextLines: 1,
			},
			signal,
		);
		const text = result.content[0]?.text ?? "";
		const envelope = result.details as ToolContext<
			Array<{ ok: boolean; result?: { data?: { matches?: unknown[] } } }>
		>;
		const expanded =
			webBatchTool.renderResult?.(result, { expanded: true }).render(120).join("\n") ?? "";

		expect(text).toContain("Matching line snippets by item:");
		expect(text).toContain("file.ts (1 match):");
		expect(text).toContain("> 2: beta targetNeedle");
		expect(envelope.answerContext).toContain("> 2: beta targetNeedle");
		expect(envelope.data?.[0]?.result?.data?.matches).toHaveLength(1);
		expect(expanded).toContain("status");
		expect(expanded).toContain("> 2:");
	});
});

function rawScrape(url: string, rawText: string): ScrapeResult {
	return {
		url,
		finalUrl: url,
		status: 200,
		mode: "fast",
		format: "raw",
		timing: { startedAt: "2026-01-01T00:00:00.000Z" },
		truncated: false,
		contentType: "text/plain; charset=utf-8",
		downloadedBytes: Buffer.byteLength(rawText),
		data: {
			route: "text",
			extractionPath: ["fast"],
			rawText,
			text: rawText,
		},
	};
}
