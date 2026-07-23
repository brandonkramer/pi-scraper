/** @file Browser **tests** browser-smoke.test module. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeStorageDbs } from "../../storage/db/open.ts";
import { webScrapeTool } from "../../tools/web-scrape.ts";
import type { ToolContext } from "../../types.ts";

const browserEnabled = process.env.PI_SCRAPER_BROWSER === "1";
let rootDir: string;
let originalStorageRoot: string | undefined;

beforeEach(async () => {
	rootDir = await mkdtemp(path.join(tmpdir(), "pi-scraper-browser-"));
	originalStorageRoot = process.env.PI_SCRAPER_STORAGE_ROOT;
	process.env.PI_SCRAPER_STORAGE_ROOT = rootDir;
});

afterEach(async () => {
	await closeStorageDbs();
	if (originalStorageRoot === undefined) delete process.env.PI_SCRAPER_STORAGE_ROOT;
	else process.env.PI_SCRAPER_STORAGE_ROOT = originalStorageRoot;
	await rm(rootDir, { recursive: true, force: true });
});

describe.skipIf(!browserEnabled)("opt-in browser-mode smoke", () => {
	it("renders a public page through lazy Playwright browser mode", async () => {
		const result = await webScrapeTool.execute(
			"browser-smoke",
			{
				url: "https://example.com/",
				mode: "browser",
				format: "text",
				timeoutSeconds: 20,
			},
			new AbortController().signal,
		);
		const envelope = result.details as ToolContext;

		expect(envelope.error).toBeUndefined();
		expect(envelope.mode).toBe("browser");
		expect(JSON.stringify(envelope.data).toLowerCase()).toContain("example domain");
	});
});

describe.skipIf(browserEnabled)("opt-in browser-mode smoke", () => {
	it("is skipped unless PI_SCRAPER_BROWSER=1", () => {
		expect(process.env.PI_SCRAPER_BROWSER).not.toBe("1");
	});
});
