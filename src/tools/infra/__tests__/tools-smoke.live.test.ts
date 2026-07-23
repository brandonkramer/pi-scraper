/** @file Tools **tests** tools-smoke.live.test module. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeStorageDbs } from "../../../storage/db/open.ts";
import type { ToolContext } from "../../../types.ts";
import { webMapTool } from "../../web-map.ts";
import { webScrapeTool } from "../../web-scrape.ts";

const liveEnabled = process.env.PI_SCRAPER_LIVE === "1";
let rootDir: string;
let originalStorageRoot: string | undefined;

beforeEach(async () => {
	rootDir = await mkdtemp(path.join(tmpdir(), "pi-scraper-live-"));
	originalStorageRoot = process.env.PI_SCRAPER_STORAGE_ROOT;
	process.env.PI_SCRAPER_STORAGE_ROOT = rootDir;
});

afterEach(async () => {
	await closeStorageDbs();
	if (originalStorageRoot === undefined) delete process.env.PI_SCRAPER_STORAGE_ROOT;
	else process.env.PI_SCRAPER_STORAGE_ROOT = originalStorageRoot;
	await rm(rootDir, { recursive: true, force: true });
});

describe.skipIf(!liveEnabled)("opt-in live network smoke", () => {
	it("scrapes a public static page through the real HTTP stack", async () => {
		const result = await webScrapeTool.execute(
			"live-scrape",
			{
				url: "https://example.com/",
				mode: "fast",
				format: "markdown",
				timeoutSeconds: 15,
			},
			new AbortController().signal,
		);
		const envelope = result.details as ToolContext;

		expect(envelope.error).toBeUndefined();
		expect(envelope.status).toBeGreaterThanOrEqual(200);
		expect(envelope.status).toBeLessThan(400);
		expect(JSON.stringify(envelope.data).toLowerCase()).toContain("example domain");
	});

	it("runs discovery mapping through real robots/sitemap probes", async () => {
		const result = await webMapTool.execute(
			"live-map",
			{ url: "https://example.com/", maxSitemaps: 2 },
			new AbortController().signal,
		);
		const envelope = result.details as ToolContext;

		expect(envelope.error).toBeUndefined();
		expect(envelope.responseId).toBeTruthy();
		expect(envelope.fullOutputPath).toContain(path.join(rootDir, "blobs"));
	});
});

describe.skipIf(liveEnabled)("opt-in live network smoke", () => {
	it("is skipped unless PI_SCRAPER_LIVE=1", () => {
		expect(process.env.PI_SCRAPER_LIVE).not.toBe("1");
	});
});
