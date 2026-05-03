import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCrawl } from "../../crawl/runner.js";
import { diffScrapeResult } from "../../diff/snapshots.js";
import type { FetchUrlResult } from "../../http/client.js";
import type { ScrapeResult } from "../../scrape/pipeline.js";
import { storeResult } from "../../storage/results.js";
import type { ResultEnvelope } from "../../types.js";
import { createWebGetResultTool } from "../web-get-result.js";

let rootDir: string;

beforeEach(async () => {
	rootDir = await mkdtemp(path.join(tmpdir(), "pi-scraper-get-result-"));
});

afterEach(async () => {
	await rm(rootDir, { recursive: true, force: true });
});

describe("web_get_result", () => {
	it("preserves responseId retrieval", async () => {
		await storeResult({ ok: true }, { rootDir, responseId: "stored" });
		const tool = createWebGetResultTool({ storage: { rootDir } });
		const result = await tool.execute(
			"call",
			{ responseId: "stored" },
			new AbortController().signal,
		);

		expect(result.content[0]?.text).toContain("stored");
		expect((result.details as ResultEnvelope<{ ok: boolean }>).data?.ok).toBe(
			true,
		);
	});

	it("retrieves crawl status metadata by crawlId", async () => {
		await runCrawl(
			"https://example.com",
			{ rootDir, crawlId: "crawl-status", maxPages: 1 },
			{
				httpClient: {
					fetchUrl: async (url) =>
						html(url.toString(), `<html><main>Seed</main></html>`),
				},
			},
		);
		const tool = createWebGetResultTool({ storage: { rootDir } });
		const result = await tool.execute(
			"call",
			{ crawlId: "crawl-status" },
			new AbortController().signal,
		);
		const envelope = result.details as ResultEnvelope<{
			status: string;
			succeededCount: number;
		}>;

		expect(result.content[0]?.text).toContain("done");
		expect(envelope.data?.status).toBe("done");
		expect(envelope.data?.succeededCount).toBe(1);
	});

	it("retrieves named snapshot metadata by URL and name", async () => {
		await diffScrapeResult(scrapeResult("https://example.com", "Baseline"), {
			rootDir,
			snapshotName: "homepage",
		});
		const tool = createWebGetResultTool({ storage: { rootDir } });
		const result = await tool.execute(
			"call",
			{ snapshotUrl: "https://example.com", snapshotName: "homepage" },
			new AbortController().signal,
		);
		const envelope = result.details as ResultEnvelope<{
			metadata: { snapshotName?: string; url: string };
		}>;

		expect(result.content[0]?.text).toContain("homepage");
		expect(envelope.data?.metadata.snapshotName).toBe("homepage");
		expect(envelope.data?.metadata.url).toBe("https://example.com");
	});

	it("lists snapshot metadata alongside other lookup modes", async () => {
		await diffScrapeResult(scrapeResult("https://example.com", "Baseline"), {
			rootDir,
			snapshotName: "homepage",
		});
		const tool = createWebGetResultTool({ storage: { rootDir } });
		const result = await tool.execute(
			"call",
			{ listSnapshots: true, snapshotUrl: "https://example.com" },
			new AbortController().signal,
		);
		const envelope = result.details as ResultEnvelope<{
			snapshots: Array<{ metadata: { snapshotName?: string } }>;
		}>;

		expect(result.content[0]?.text).toContain("1 snapshot");
		expect(envelope.data?.snapshots[0]?.metadata.snapshotName).toBe("homepage");
	});
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

function scrapeResult(url: string, text: string): ScrapeResult {
	return {
		url,
		finalUrl: url,
		status: 200,
		mode: "fast",
		format: "markdown",
		timing: { startedAt: new Date().toISOString() },
		truncated: false,
		contentType: "text/html",
		data: {
			route: "html",
			extractionPath: ["fast"],
			markdown: text,
		},
	};
}
