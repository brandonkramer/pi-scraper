import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ResultEnvelope } from "../../types.js";
import { webMapTool } from "../web-map.js";
import { webScrapeTool } from "../web-scrape.js";

const liveEnabled = process.env.PI_SCRAPER_LIVE === "1";
let homeDir: string;
let originalHome: string | undefined;

beforeEach(async () => {
	homeDir = await mkdtemp(path.join(tmpdir(), "pi-scraper-live-"));
	originalHome = process.env.HOME;
	process.env.HOME = homeDir;
});

afterEach(async () => {
	if (originalHome === undefined) delete process.env.HOME;
	else process.env.HOME = originalHome;
	await rm(homeDir, { recursive: true, force: true });
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
		const envelope = result.details as ResultEnvelope;

		expect(envelope.error).toBeUndefined();
		expect(envelope.status).toBeGreaterThanOrEqual(200);
		expect(envelope.status).toBeLessThan(400);
		expect(JSON.stringify(envelope.data).toLowerCase()).toContain(
			"example domain",
		);
	});

	it("runs discovery mapping through real robots/sitemap probes", async () => {
		const result = await webMapTool.execute(
			"live-map",
			{ url: "https://example.com/", maxSitemaps: 2 },
			new AbortController().signal,
		);
		const envelope = result.details as ResultEnvelope;

		expect(envelope.error).toBeUndefined();
		expect(envelope.responseId).toBeTruthy();
		expect(envelope.fullOutputPath).toContain(
			path.join(homeDir, ".pi", "results"),
		);
	});
});

describe.skipIf(liveEnabled)("opt-in live network smoke", () => {
	it("is skipped unless PI_SCRAPER_LIVE=1", () => {
		expect(process.env.PI_SCRAPER_LIVE).not.toBe("1");
	});
});
