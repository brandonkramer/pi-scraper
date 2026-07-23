/** @file Tool-level regression coverage for web_batch context. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BatchScrapeResult } from "../../batch/run.ts";
import type { ScrapeResult } from "../../scrape/pipeline.ts";
import { closeStorageDbs } from "../../storage/db/open.ts";
import { getJobManifest } from "../../storage/jobs/manifest.ts";
import { readResponse } from "../../storage/responses/read.ts";
import type { ToolContext } from "../../types.ts";
import { webBatchTool } from "../web-batch.ts";
import { webGetResultTool } from "../web-get-result.ts";

vi.mock("../../batch/run.ts", () => ({
	runBatchScrape: vi.fn(async (): Promise<BatchScrapeResult> => {
		const { createJobManifest, writeJobManifest } = await import("../../storage/jobs/manifest.ts");
		const { storeResponse } = await import("../../storage/responses/store.ts");
		const jobId = "batch-context";
		await writeJobManifest(
			createJobManifest({
				jobId,
				jobType: "batch",
				status: "done",
				params: { urls: ["https://docs.example.com/guide"] },
			}),
		);
		const items = [
			{
				ok: true as const,
				index: 0,
				url: "https://docs.example.com/guide",
				result: docsPage("https://docs.example.com/guide"),
			},
		];
		const stored = await storeResponse(items);
		return {
			items,
			responseId: stored.responseId,
			fullOutputPath: stored.fullOutputPath,
			jobId,
			truncated: false,
			summary: "Batch scrape complete: 1 succeeded, 0 failed, 1 total.",
		};
	}),
}));

const signal = new AbortController().signal;
let rootDir: string;
let originalStorageRoot: string | undefined;

beforeEach(async () => {
	rootDir = await mkdtemp(path.join(tmpdir(), "pi-scraper-batch-package-"));
	originalStorageRoot = process.env.PI_SCRAPER_STORAGE_ROOT;
	process.env.PI_SCRAPER_STORAGE_ROOT = rootDir;
});

afterEach(async () => {
	await closeStorageDbs();
	if (originalStorageRoot === undefined) delete process.env.PI_SCRAPER_STORAGE_ROOT;
	else process.env.PI_SCRAPER_STORAGE_ROOT = originalStorageRoot;
	await rm(rootDir, { recursive: true, force: true });
});

describe("web_batch context", () => {
	it("stores and retrieves a compiled package when requested", async () => {
		const result = await webBatchTool.execute(
			"call",
			{ urls: ["https://docs.example.com/guide"], compile: true },
			signal,
		);
		const envelope = result.details as ToolContext<unknown[]>;
		const diagnostics = envelope.diagnostics as {
			contextPackage?: {
				responseId: string;
				package: { source: string; batchId?: string; urlCount: number };
			};
		};

		expect(result.content[0]?.text).toContain("Context: 1 page(s)");
		expect(Array.isArray(envelope.data)).toBe(true);
		expect(diagnostics.contextPackage?.package.source).toBe("batch");
		expect(diagnostics.contextPackage?.package.urlCount).toBe(1);

		const packageResponseId = diagnostics.contextPackage!.responseId;
		const stored = await readResponse<{
			package: { source: string; batchId?: string };
			tree: Array<{ title?: string; excerpt?: string }>;
		}>(packageResponseId);
		expect(stored.value.package.batchId).toBe("batch-context");
		expect(stored.value.tree[0]?.title).toBe("Guide");
		expect(stored.value.tree[0]?.excerpt).toContain("Install the package");

		const fetched = await webGetResultTool.execute(
			"call",
			{ responseId: packageResponseId },
			signal,
		);
		expect((fetched.details as ToolContext).data).toMatchObject({
			package: { source: "batch" },
		});

		const manifest = await getJobManifest("batch-context");
		expect(manifest.manifest.responseIds).toContain(packageResponseId);
	});

	it("stores labeled-text match previews with line numbers", async () => {
		const result = await webBatchTool.execute(
			"call",
			{
				urls: ["https://docs.example.com/guide"],
				compile: { mode: "labeled-text" },
				linesMatching: ["fetchMetrics"],
				contextLines: 0,
			},
			signal,
		);
		const diagnostics = (result.details as ToolContext).diagnostics as {
			contextPackage?: { responseId: string };
		};
		const packageResponseId = diagnostics.contextPackage!.responseId;
		const stored = await readResponse<{
			tree: Array<{ excerpt?: string }>;
			items: Array<{ matches?: Array<{ line: number; text: string }> }>;
		}>(packageResponseId);

		expect(result.content[0]?.text).toContain("Matching line snippets by item:");
		expect(result.content[0]?.text).toContain(
			"> 1: Guide Install the package and call fetchMetrics().",
		);
		expect(stored.value.tree[0]?.excerpt).toContain("Matching line snippets");
		expect(stored.value.tree[0]?.excerpt).toContain(
			"> 1: Guide Install the package and call fetchMetrics().",
		);
		expect(stored.value.items[0]?.matches?.[0]).toMatchObject({
			line: 1,
			text: "Guide Install the package and call fetchMetrics().",
		});
	});
});

function docsPage(url: string): ScrapeResult {
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
			title: "Guide",
			markdown: "# Guide\n\nInstall the package and call fetchMetrics().",
			text: "Guide Install the package and call fetchMetrics().",
		},
	};
}
