/** @file Storage **tests** sqlite-storage.test module. */
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createCrawlState, loadCrawlState } from "../../crawl/state.ts";
import { writeBlob } from "../blobs.ts";
import { closeStorageDbs } from "../db/open.ts";
import { readResponse } from "../responses/read.ts";
import { storeResponse } from "../responses/store.ts";
import { searchResponses, setFtsAvailabilityForTests } from "../search.ts";

let rootDir: string;

beforeEach(async () => {
	rootDir = await mkdtemp(path.join(tmpdir(), "pi-scraper-sqlite-"));
});

afterEach(async () => {
	setFtsAvailabilityForTests(undefined);
	closeStorageDbs();
	await rm(rootDir, { recursive: true, force: true });
});

describe("SQLite-backed storage", () => {
	it("stores result metadata in index.db and payload in content-addressed blobs", async () => {
		const metadata = await storeResponse(
			{ url: "https://example.com", ok: true },
			{ rootDir, responseId: "r1" },
		);
		const stored = await readResponse<{ ok: boolean }>("r1", { rootDir });

		expect(existsSync(path.join(rootDir, "index.db"))).toBe(true);
		expect(metadata.fullOutputPath).toContain(path.join(rootDir, "blobs"));
		expect(stored.value.ok).toBe(true);
	});

	it("deduplicates identical blob bytes", async () => {
		const left = await writeBlob("same", "text/plain", { rootDir });
		const right = await writeBlob("same", "text/plain", { rootDir });

		expect(left.contentHash).toBe(right.contentHash);
		expect(left.blobPath).toBe(right.blobPath);
	});

	it("indexes stored scrape text when FTS5 is available", async () => {
		const search = await searchResponses("probe", { rootDir });
		expect(search.supported, "FTS5 must be available for this test").toBe(true);
		await storeResponse(
			{
				url: "https://example.com/docs",
				data: { title: "Docs", markdown: "alpha beta searchable needle" },
			},
			{ rootDir, responseId: "searchable" },
		);

		const result = await searchResponses("needle", { rootDir });

		expect(result.supported).toBe(true);
		expect(result.hits[0]?.responseId).toBe("searchable");
	});

	it("returns an unsupported search result when FTS5 is unavailable", async () => {
		setFtsAvailabilityForTests(false);

		const result = await searchResponses("needle", { rootDir });

		expect(result.supported).toBe(false);
		expect(result.hits).toEqual([]);
	});

	it("migrates legacy result envelopes idempotently and preserves bodies", async () => {
		await mkdir(path.join(rootDir, "results"), { recursive: true });
		await writeFile(
			path.join(rootDir, "results", "legacy.json"),
			JSON.stringify({
				metadata: {
					responseId: "legacy",
					storedAt: "2026-01-01T00:00:00.000Z",
					fullOutputPath: path.join(rootDir, "results", "legacy.json"),
					contentType: "application/json",
				},
				value: { url: "https://example.com", body: "legacy body" },
			}),
		);

		const first = await readResponse<{ body: string }>("legacy", {
			rootDir,
		});
		closeStorageDbs();
		const second = await readResponse<{ body: string }>("legacy", {
			rootDir,
		});

		expect(first.value.body).toBe("legacy body");
		expect(second.value.body).toBe("legacy body");
		expect(existsSync(path.join(rootDir, "results.bak"))).toBe(true);
	});

	it("migrates legacy crawl states and preserves frontier/visited rows", async () => {
		const legacy = createCrawlState("https://example.com", "old-crawl");
		legacy.frontier = [{ url: "https://example.com/a", depth: 1 }];
		legacy.visited = ["https://example.com"];
		legacy.results = ["https://example.com"];
		await mkdir(path.join(rootDir, "crawl", "old-crawl"), { recursive: true });
		await writeFile(path.join(rootDir, "crawl", "old-crawl", "state.json"), JSON.stringify(legacy));

		const migrated = await loadCrawlState("old-crawl", { rootDir });
		closeStorageDbs();
		const migratedAgain = await loadCrawlState("old-crawl", { rootDir });

		expect(migrated.frontier[0]?.url).toBe("https://example.com/a");
		expect(migratedAgain.visited).toEqual(["https://example.com"]);
		expect(existsSync(path.join(rootDir, "crawl.bak"))).toBe(true);
	});
});
