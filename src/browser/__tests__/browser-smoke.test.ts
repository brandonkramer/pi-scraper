/** @file Browser **tests** browser-smoke.test module. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { webScrapeTool } from "../../tools/web-scrape.ts";
import type { ToolContext } from "../../types.ts";

const browserEnabled = process.env.PI_SCRAPER_BROWSER === "1";
let homeDir: string;
let originalHome: string | undefined;

beforeEach(async () => {
	homeDir = await mkdtemp(path.join(tmpdir(), "pi-scraper-browser-"));
	originalHome = process.env.HOME;
	process.env.HOME = homeDir;
});

afterEach(async () => {
	if (originalHome === undefined) delete process.env.HOME;
	else process.env.HOME = originalHome;
	await rm(homeDir, { recursive: true, force: true });
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
