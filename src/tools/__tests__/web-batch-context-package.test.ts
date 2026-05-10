/**
 * @fileoverview Tool-level regression coverage for web_batch context.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BatchScrapeResult } from "../../batch/run.ts";
import type { ScrapeResult } from "../../scrape/pipeline.ts";
import { closeStorageDbs } from "../../storage/db/open.ts";
import { getJobManifest } from "../../storage/jobs/manifest.ts";
import { readResponse } from "../../storage/responses/read.ts";
import type { ResultEnvelope } from "../../types.ts";
import { webBatchTool } from "../web-batch.ts";
import { webGetResultTool } from "../web-get-result.ts";

vi.mock("../../batch/run.ts", () => ({
	runBatchScrape: vi.fn(async (): Promise<BatchScrapeResult> => {
		const { createJobManifest, writeJobManifest } = await import(
			"../../storage/jobs/manifest.ts"
		);
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
let homeDir: string;
let originalHome: string | undefined;

beforeEach(async () => {
	homeDir = await mkdtemp(path.join(tmpdir(), "pi-scraper-batch-package-"));
	originalHome = process.env.HOME;
	process.env.HOME = homeDir;
});

afterEach(async () => {
	closeStorageDbs();
	if (originalHome === undefined) delete process.env.HOME;
	else process.env.HOME = originalHome;
	await rm(homeDir, { recursive: true, force: true });
});

describe("web_batch context", () => {
	it("stores and retrieves a compiled package when requested", async () => {
		const result = await webBatchTool.execute(
			"call",
			{ urls: ["https://docs.example.com/guide"], compile: true },
			signal,
		);
		const envelope = result.details as ResultEnvelope<unknown[]>;
		const diagnostics = envelope.diagnostics as {
			contextPackage?: {
				responseId: string;
				package: { source: string; batchId?: string; urlCount: number };
			};
		};

		expect(result.content[0]?.text).toContain("Context package: 1 page(s)");
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
		expect((fetched.details as ResultEnvelope).data).toMatchObject({
			package: { source: "batch" },
		});

		const manifest = await getJobManifest("batch-context");
		expect(manifest.manifest.responseIds).toContain(packageResponseId);
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
