/**
 * @file All web_scrape tool tests — one describe per concern (snapshot writing, saveToFile,
 *   downloads).
 */
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ScrapeResult } from "../../scrape/pipeline.ts";
import { closeStorageDbs } from "../../storage/db/open.ts";
import { setFtsAvailabilityForTests } from "../../storage/search.ts";
import type { ToolContext } from "../../types.ts";

const scrapePipelineMock = vi.hoisted(() => ({
	scrapeUrl: vi.fn(),
}));

vi.mock("../../scrape/pipeline.ts", () => ({
	scrapeUrl: scrapePipelineMock.scrapeUrl,
}));

const { createWebScrapeTool, diffInterpretation } = await import("../web-scrape.ts");

const signal = new AbortController().signal;
let rootDir: string;
let originalStorageRoot: string | undefined;

function fakeScrapeResult(url: string, text: string): ScrapeResult {
	return {
		url,
		finalUrl: url,
		status: 200,
		mode: "fast",
		format: "markdown",
		timing: { startedAt: "2026-01-01T00:00:00.000Z" },
		truncated: false,
		contentType: "text/html; charset=utf-8",
		downloadedBytes: Buffer.byteLength(text),
		data: {
			route: "html",
			extractionPath: ["fast"],
			rawText: text,
			text,
			markdown: text,
			html: `<p>${text}</p>`,
		},
	};
}

beforeEach(async () => {
	rootDir = await mkdtemp(join(tmpdir(), "scrape-snap-"));
	originalStorageRoot = process.env.PI_SCRAPER_STORAGE_ROOT;
	process.env.PI_SCRAPER_STORAGE_ROOT = rootDir;
	setFtsAvailabilityForTests(false);
	scrapePipelineMock.scrapeUrl.mockReset();
});

afterEach(async () => {
	await closeStorageDbs();
	if (originalStorageRoot === undefined) delete process.env.PI_SCRAPER_STORAGE_ROOT;
	else process.env.PI_SCRAPER_STORAGE_ROOT = originalStorageRoot;
	setFtsAvailabilityForTests(undefined);
	await rm(rootDir, { recursive: true, force: true });
});

describe("web_scrape snapshot writing", () => {
	it("saves a snapshot when snapshotName is set", async () => {
		scrapePipelineMock.scrapeUrl.mockResolvedValue(
			fakeScrapeResult("https://example.com/snap-1", "Hello world baseline"),
		);

		const result = await createWebScrapeTool().execute(
			"call",
			{ url: "https://example.com/snap-1", snapshotName: "test-snap" },
			signal,
		);
		const details = result.details as ToolContext;

		expect(details.snapshotSaved).toBeDefined();
		expect(details.snapshotSaved?.name).toBe("test-snap");
		expect(details.snapshotSaved?.tag).toBeUndefined();
		expect(details.snapshotSaved?.path).toBeTruthy();

		const snapshotContent = await readFile(details.snapshotSaved!.path, "utf8");
		const snapshot = JSON.parse(snapshotContent);
		expect(snapshot.snapshotName).toBe("test-snap");
		expect(snapshot.content.text).toContain("Hello world baseline");

		expect(result.content[0]?.text).toContain('snapshot saved as "test-snap"');
	});

	it("includes tag when snapshotTag is set", async () => {
		scrapePipelineMock.scrapeUrl.mockResolvedValue(
			fakeScrapeResult("https://example.com/snap-2", "Tagged content"),
		);

		const result = await createWebScrapeTool().execute(
			"call",
			{ url: "https://example.com/snap-2", snapshotName: "tagged", snapshotTag: "v1" },
			signal,
		);
		const details = result.details as ToolContext;

		expect(details.snapshotSaved).toBeDefined();
		expect(details.snapshotSaved?.name).toBe("tagged");
		expect(details.snapshotSaved?.tag).toBe("v1");
		expect(details.snapshotSaved?.path).toBeTruthy();

		const snapshotContent = await readFile(details.snapshotSaved!.path, "utf8");
		const snapshot = JSON.parse(snapshotContent);
		expect(snapshot.snapshotTag).toBe("v1");

		expect(result.content[0]?.text).toContain('snapshot saved as "tagged"');
		expect(result.content[0]?.text).toContain("tag: v1");
	});

	it("overwrites previous snapshot for same name", async () => {
		scrapePipelineMock.scrapeUrl.mockResolvedValue(
			fakeScrapeResult("https://example.com/overwrite", "Overwritten content"),
		);

		const first = await createWebScrapeTool().execute(
			"call",
			{ url: "https://example.com/overwrite", snapshotName: "overwrite-me" },
			signal,
		);
		const firstDetails = first.details as ToolContext;
		const path1 = firstDetails.snapshotSaved!.path;

		const second = await createWebScrapeTool().execute(
			"call",
			{ url: "https://example.com/overwrite", snapshotName: "overwrite-me" },
			signal,
		);
		const secondDetails = second.details as ToolContext;
		const path2 = secondDetails.snapshotSaved!.path;

		expect(path1).toBe(path2);

		const content = await readFile(path2, "utf8");
		const snapshot = JSON.parse(content);
		expect(snapshot.content.text).toContain("Overwritten content");
	});

	it("omits snapshotSaved when snapshotName is not set", async () => {
		scrapePipelineMock.scrapeUrl.mockResolvedValue(
			fakeScrapeResult("https://example.com/no-snap", "No snapshot"),
		);

		const result = await createWebScrapeTool().execute(
			"call",
			{ url: "https://example.com/no-snap" },
			signal,
		);
		const details = result.details as ToolContext;

		expect(details.snapshotSaved).toBeUndefined();
	});

	it("does not save snapshot on scrape error", async () => {
		scrapePipelineMock.scrapeUrl.mockResolvedValue({
			url: "https://example.com/error",
			error: { code: "FETCH_FAILED", phase: "fetch", message: "Network error", retryable: true },
			status: 0,
			mode: "fast",
			format: "markdown",
			timing: { startedAt: "2026-01-01T00:00:00.000Z" },
			truncated: false,
			contentType: "text/html",
			data: { route: "html", extractionPath: ["fast"], rawText: "", text: "" },
		});

		const result = await createWebScrapeTool().execute(
			"call",
			{ url: "https://example.com/error", snapshotName: "fail-test" },
			signal,
		);
		const details = result.details as ToolContext;

		expect(details.snapshotSaved).toBeUndefined();
	});

	it("attaches responseId to snapshot metadata", async () => {
		scrapePipelineMock.scrapeUrl.mockResolvedValue(
			fakeScrapeResult("https://example.com/snap-response", "Snapshot with response"),
		);

		const result = await createWebScrapeTool().execute(
			"call",
			{ url: "https://example.com/snap-response", snapshotName: "response-compat" },
			signal,
		);
		const details = result.details as ToolContext;

		const snapPath = details.snapshotSaved!.path;
		const snapshotData = JSON.parse(await readFile(snapPath, "utf8"));
		expect(snapshotData.snapshotName).toBe("response-compat");
		expect(snapshotData.content.text).toContain("Snapshot with response");
		expect(snapshotData.metadata.responseId).toBeTruthy();
		expect(details.responseId).toBeTruthy();
	});
});

describe("web_scrape saveToFile schema", () => {
	it("schema includes saveToFile param", () => {
		const tool = createWebScrapeTool();
		const schema = tool.parameters as { properties: Record<string, unknown> };
		expect(schema.properties).toHaveProperty("saveToFile");
	});

	it("saveToFile param has a description", () => {
		const tool = createWebScrapeTool();
		const saveToFile = (tool.parameters as { properties: Record<string, unknown> }).properties
			.saveToFile as { description?: string };
		expect(saveToFile.description?.length).toBeGreaterThan(0);
	});
});

describe("saveBodyToDownloads integration", () => {
	it("derives filename from URL", async () => {
		const { deriveFilename } = await import("../../http/download-storage.ts");
		expect(deriveFilename("https://example.com/report.pdf", "application/pdf")).toBe("report.pdf");
	});

	it("sanitizes dangerous filenames", async () => {
		const { sanitizeFilename } = await import("../../http/download-storage.ts");
		expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
	});

	it("streams body to content-addressed file", async () => {
		const { saveBodyToDownloads } = await import("../../http/download-storage.ts");
		const { Readable } = await import("node:stream");
		const path = await import("node:path");

		const testDir = path.join(
			import.meta.dirname,
			"..",
			"..",
			"..",
			".test-tmp",
			"savefile-integration",
		);
		await mkdir(testDir, { recursive: true });

		const content = Buffer.from("integration test body");
		const body = Readable.from([content]);
		const result = await saveBodyToDownloads(
			body,
			"text/plain",
			"https://example.com/test.txt",
			undefined,
			{ dir: testDir },
		);

		expect(result.bytes).toBe(21);
		expect(result.filePath).toContain(testDir);
		expect(result.filePath).toContain("test.txt");

		const saved = await readFile(result.filePath);
		expect(saved.toString()).toBe("integration test body");

		await rm(testDir, { recursive: true, force: true });
	});
});

describe("web_scrape diff interpretation", () => {
	it("web_diff interpretation distinguishes baseline, unchanged, and changed states", () => {
		expect(
			diffInterpretation({
				previous: undefined,
				snapshotName: "home",
			} as never),
		).toContain("saved a baseline");
		expect(
			diffInterpretation({
				previous: {},
				summary: { unchangedAfterNormalization: true },
				snapshotName: "home",
			} as never),
		).toContain("No meaningful content changes");
		expect(
			diffInterpretation({
				previous: {},
				diff: { changedCount: 1, addedCount: 2, removedCount: 3 },
				summary: {
					unchangedAfterNormalization: false,
					addedHeadings: ["A"],
					removedHeadings: [],
					addedLinks: [],
					removedLinks: [{}],
				},
				snapshotName: "home",
			} as never),
		).toContain("Content changed");
	});
});
