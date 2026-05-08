/**
 * @fileoverview storage __tests__ results.test module.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolvePiStoragePaths } from "../paths.js";
import { getStoredResult, storeResult, truncateAndStore } from "../results.js";

let rootDir: string;

beforeEach(async () => {
	rootDir = await mkdtemp(path.join(tmpdir(), "pi-scraper-storage-"));
});

afterEach(async () => {
	await rm(rootDir, { recursive: true, force: true });
});

describe("storage paths and results", () => {
	it("resolves default runtime storage under ~/.pi/scraper", () => {
		const paths = resolvePiStoragePaths();
		expect(paths.root).toBe(
			path.join(process.env.HOME ?? "", ".pi", "scraper"),
		);
		expect(paths.results).toBe(path.join(paths.root, "results"));
		expect(paths.crawl).toBe(path.join(paths.root, "crawl"));
		expect(paths.snapshots).toBe(path.join(paths.root, "snapshots"));
	});

	it("resolves storage paths from an override root", () => {
		const paths = resolvePiStoragePaths({ rootDir });
		expect(paths.results).toBe(path.join(rootDir, "results"));
		expect(paths.crawl).toBe(path.join(rootDir, "crawl"));
		expect(paths.snapshots).toBe(path.join(rootDir, "snapshots"));
	});

	it("stores and retrieves values by responseId", async () => {
		const metadata = await storeResult(
			{ ok: true },
			{ rootDir, responseId: "abc" },
		);
		const stored = await getStoredResult<{ ok: boolean }>("abc", { rootDir });
		expect(metadata.responseId).toBe("abc");
		expect(stored.value.ok).toBe(true);
	});

	it("stores full output when text exceeds inline limits", async () => {
		const output = await truncateAndStore(
			"x".repeat(60_000),
			{ full: true },
			{ rootDir },
		);
		expect(output.truncated).toBe(true);
		expect(output.metadata?.responseId).toBeTruthy();
		expect(output.text.length).toBeLessThan(60_000);
	});
});
