/** @file Diff **tests** snapshots.test module. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ScrapeResult } from "../../scrape/pipeline.ts";
import { openStorageDb, closeStorageDbs } from "../../storage/db/open.ts";
import { storeResponse } from "../../storage/responses/store.ts";
import { compareSnapshotText } from "../compare.ts";
import { normalizeVolatileSnapshotText } from "../normalize.ts";
import {
	diffScrapeResult,
	listSnapshots,
	loadSnapshot,
	updateSnapshotReference,
} from "../snapshots.ts";

function snapshotTagComparator(left: string | undefined, right: string | undefined): number {
	return (left ?? "").localeCompare(right ?? "");
}

let rootDir: string;

beforeEach(async () => {
	rootDir = await mkdtemp(path.join(tmpdir(), "pi-scraper-diff-"));
});

afterEach(async () => {
	await closeStorageDbs();
	await rm(rootDir, { recursive: true, force: true });
});

describe("snapshot diffing", () => {
	it("compares added, removed, changed, and unchanged normalized lines", () => {
		const diff = compareSnapshotText("a\nb\nPrice: $10", "b\nc\nPrice: $12");
		expect(diff.changed.map((entry) => [entry.previous, entry.current])).toEqual([
			["Price: $10", "Price: $12"],
		]);
		expect(diff.added).toEqual(["c"]);
		expect(diff.removed).toEqual(["a"]);
		expect(diff.unchanged).toBe(1);
	});

	it("stores deterministic snapshots and diffs the next scrape", async () => {
		await diffScrapeResult(result("https://example.com", "A\nB"), { rootDir });
		const second = await diffScrapeResult(result("https://example.com", "B\nC"), { rootDir });
		expect(second.previous?.content.text).toBe("A\nB");
		expect(second.diff?.added).toEqual(["C"]);
		expect(second.diff?.removed).toEqual(["A"]);
	});

	it("keeps named snapshots isolated for the same URL", async () => {
		await diffScrapeResult(result("https://example.com", "Baseline A"), {
			rootDir,
			snapshotName: "homepage",
		});
		await diffScrapeResult(result("https://example.com", "Baseline B"), {
			rootDir,
			snapshotName: "docs",
		});
		const homepage = await loadSnapshot("https://example.com", {
			rootDir,
			snapshotName: "homepage",
		});
		const docs = await loadSnapshot("https://example.com", {
			rootDir,
			snapshotName: "docs",
		});
		expect(homepage?.content.text).toBe("Baseline A");
		expect(docs?.content.text).toBe("Baseline B");
	});

	it("keeps untagged named snapshots isolated from tagged snapshots", async () => {
		await diffScrapeResult(result("https://example.com/docs", "Untagged docs"), {
			rootDir,
			snapshotName: "docs",
		});
		await diffScrapeResult(result("https://example.com/docs", "Tagged docs"), {
			rootDir,
			snapshotName: "docs",
			snapshotTag: "v1.0.0",
		});

		const untagged = await loadSnapshot("https://example.com/docs", {
			rootDir,
			snapshotName: "docs",
		});
		const tagged = await loadSnapshot("https://example.com/docs", {
			rootDir,
			snapshotName: "docs",
			snapshotTag: "v1.0.0",
		});
		const current = await diffScrapeResult(
			result("https://example.com/docs", "Current untagged docs"),
			{ rootDir, snapshotName: "docs" },
		);

		expect(untagged?.content.text).toBe("Untagged docs");
		expect(tagged?.content.text).toBe("Tagged docs");
		expect(current.previous?.content.text).toBe("Untagged docs");
	});

	it("keeps unnamed snapshots isolated from named snapshots for the same URL", async () => {
		await diffScrapeResult(result("https://example.com", "Unnamed baseline"), {
			rootDir,
		});
		await diffScrapeResult(result("https://example.com", "Named baseline"), {
			rootDir,
			snapshotName: "homepage",
		});

		const unnamed = await loadSnapshot("https://example.com", { rootDir });
		const named = await loadSnapshot("https://example.com", {
			rootDir,
			snapshotName: "homepage",
		});
		const current = await diffScrapeResult(result("https://example.com", "Current unnamed"), {
			rootDir,
		});

		expect(unnamed?.content.text).toBe("Unnamed baseline");
		expect(named?.content.text).toBe("Named baseline");
		expect(current.previous?.content.text).toBe("Unnamed baseline");
	});

	it("stores tagged snapshots and diffs against a tagged baseline", async () => {
		const first = await diffScrapeResult(result("https://example.com/docs", "Version one docs"), {
			rootDir,
			snapshotName: "docs",
			snapshotTag: "v1.0.0",
		});
		const second = await diffScrapeResult(result("https://example.com/docs", "Version two docs"), {
			rootDir,
			snapshotName: "docs",
			snapshotTag: "v2.0.0",
			compareTag: "v1.0.0",
		});
		const tagged = await loadSnapshot("https://example.com/docs", {
			rootDir,
			snapshotName: "docs",
			snapshotTag: "v1.0.0",
		});
		const entries = await listSnapshots({
			rootDir,
			url: "https://example.com/docs",
			snapshotName: "docs",
		});

		expect(first.current.snapshotTag).toBe("v1.0.0");
		expect(second.previous?.content.text).toBe("Version one docs");
		expect(second.current.snapshotTag).toBe("v2.0.0");
		expect(second.compareTag).toBe("v1.0.0");
		expect(tagged?.content.text).toBe("Version one docs");
		expect(
			entries.map((entry) => entry.metadata.snapshotTag).toSorted(snapshotTagComparator),
		).toEqual(["v1.0.0", "v2.0.0"]);
	});

	it("returns a structured error when a compare tag is missing", async () => {
		await expect(
			diffScrapeResult(result("https://example.com/docs", "Current docs"), {
				rootDir,
				snapshotTag: "v2.0.0",
				compareTag: "v1.0.0",
			}),
		).rejects.toMatchObject({
			structured: { code: "SNAPSHOT_TAG_NOT_FOUND", phase: "diff" },
		});
	});

	it("upserts named snapshot references transactionally in SQLite", async () => {
		const first = await diffScrapeResult(result("https://example.com", "Baseline A"), {
			rootDir,
			snapshotName: "homepage",
		});
		await updateSnapshotReference(
			"https://example.com",
			await storeResponse(first, { rootDir, responseId: "diff-1" }),
			{ rootDir, snapshotName: "homepage" },
		);
		const second = await diffScrapeResult(result("https://example.com", "Baseline B"), {
			rootDir,
			snapshotName: "homepage",
		});
		await updateSnapshotReference(
			"https://example.com",
			await storeResponse(second, { rootDir, responseId: "diff-2" }),
			{ rootDir, snapshotName: "homepage" },
		);
		const db = await openStorageDb({ rootDir });
		const count = db
			.prepare("SELECT COUNT(*) AS count FROM snapshots WHERE snapshot_name = ?")
			.get("homepage") as { count: number };
		const loaded = await loadSnapshot("https://example.com", {
			rootDir,
			snapshotName: "homepage",
		});

		expect(count.count).toBe(1);
		expect(loaded?.content.text).toBe("Baseline B");
	});

	it("persists snapshot metadata and lists snapshots by URL/name", async () => {
		const first = await diffScrapeResult(
			result("https://example.com", "# Title\nParagraph with enough words to summarize.", {
				status: 201,
				contentType: "text/html",
				downloadedBytes: 123,
			}),
			{ rootDir, snapshotName: "homepage" },
		);
		const entries = await listSnapshots({
			rootDir,
			url: "https://example.com",
			snapshotName: "homepage",
		});
		expect(entries).toHaveLength(1);
		expect(entries[0]?.metadata).toMatchObject({
			url: "https://example.com",
			finalUrl: "https://example.com",
			mode: "fast",
			format: "markdown",
			statusCode: 201,
			contentType: "text/html",
			contentLength: 123,
			snapshotName: "homepage",
		});
		expect(entries[0]?.metadata.contentHash).toHaveLength(64);
		expect(entries[0]?.metadata.normalizedHash).toHaveLength(64);
		expect(first.current.content.headings).toEqual(["Title"]);
	});

	it("summarizes headings, links, metadata, and paragraph changes", async () => {
		await diffScrapeResult(
			result("https://example.com", "# Old\nParagraph one has enough words to count.", {
				title: "Old",
				links: [{ url: "https://example.com/a", text: "A" }],
			}),
			{ rootDir },
		);
		const second = await diffScrapeResult(
			result("https://example.com", "# New\nParagraph two has enough words to count.", {
				title: "New",
				links: [{ url: "https://example.com/b", text: "B" }],
			}),
			{ rootDir },
		);
		expect(second.summary?.addedHeadings).toEqual(["New"]);
		expect(second.summary?.removedHeadings).toEqual(["Old"]);
		expect(second.summary?.addedLinks.map((link) => link.url)).toEqual(["https://example.com/b"]);
		expect(second.summary?.removedLinks.map((link) => link.url)).toEqual(["https://example.com/a"]);
		expect(second.summary?.changedMetadata.some((entry) => entry.key === "title")).toBe(true);
		expect(second.summary?.paragraphs.changedCount).toBe(1);
	});

	it("normalizes conservative volatile values without hiding semantic text", async () => {
		const before =
			"Last updated 2 minutes ago\nRead https://example.com/?utm_source=x&token=abcdef1234567890\nPrice: $10";
		const after =
			"Last updated 3 minutes ago\nRead https://example.com/?utm_source=y&token=zzzzzz1234567890\nPrice: $10";
		expect(normalizeVolatileSnapshotText(before)).toBe(normalizeVolatileSnapshotText(after));
		await diffScrapeResult(result("https://example.com", before), { rootDir });
		const second = await diffScrapeResult(result("https://example.com", after), { rootDir });
		expect(second.summary?.unchangedAfterNormalization).toBe(true);
		expect(second.diff?.addedCount).toBe(0);
	});
});

function result(
	url: string,
	text: string,
	overrides: Partial<ScrapeResult> & { title?: string; links?: unknown[] } = {},
): ScrapeResult {
	return {
		url,
		finalUrl: url,
		status: overrides.status ?? 200,
		mode: "fast",
		format: "markdown",
		timing: { startedAt: new Date().toISOString() },
		truncated: false,
		contentType: overrides.contentType,
		downloadedBytes: overrides.downloadedBytes,
		data: {
			route: "html",
			extractionPath: ["fast"],
			markdown: text,
			title: overrides.title,
			metadata: { title: overrides.title },
			links: overrides.links,
		},
	};
}
