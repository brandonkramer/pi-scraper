/** @file Browser **tests** browser-smoke.test module. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeStorageDbs } from "../../storage/db/open.ts";
import { webScrapeTool } from "../../tools/web-scrape.ts";
import type { ToolContext } from "../../types.ts";
import { closeAllBrowserSessions } from "../session-pool.ts";

const browserEnabled = process.env.PI_SCRAPER_BROWSER === "1";
let rootDir: string;
let originalStorageRoot: string | undefined;

beforeEach(async () => {
	rootDir = await mkdtemp(path.join(tmpdir(), "pi-scraper-browser-"));
	originalStorageRoot = process.env.PI_SCRAPER_STORAGE_ROOT;
	process.env.PI_SCRAPER_STORAGE_ROOT = rootDir;
});

afterEach(async () => {
	await closeAllBrowserSessions();
	await closeStorageDbs();
	if (originalStorageRoot === undefined) delete process.env.PI_SCRAPER_STORAGE_ROOT;
	else process.env.PI_SCRAPER_STORAGE_ROOT = originalStorageRoot;
	await rm(rootDir, { recursive: true, force: true });
});

describe.skipIf(!browserEnabled)("opt-in browser-mode smoke", () => {
	it("renders a public page and reopens a CloakBrowser persistent profile", async () => {
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
		const initialEnvelope = result.details as ToolContext;

		expect(initialEnvelope.error).toBeUndefined();
		expect(initialEnvelope.mode).toBe("cloak");
		expect(JSON.stringify(initialEnvelope.data).toLowerCase()).toContain("example domain");

		const input = {
			url: "https://example.com/",
			mode: "browser" as const,
			format: "text" as const,
			timeoutSeconds: 20,
			sessionId: "persistent-smoke",
			saveSession: true,
			refresh: true,
		};

		const first = await webScrapeTool.execute(
			"browser-persistent-smoke-first",
			input,
			new AbortController().signal,
		);
		expect((first.details as ToolContext).error).toBeUndefined();

		await closeAllBrowserSessions();

		const reopened = await webScrapeTool.execute(
			"browser-persistent-smoke-reopen",
			input,
			new AbortController().signal,
		);
		const envelope = reopened.details as ToolContext;
		expect(envelope.error).toBeUndefined();
		expect(envelope.mode).toBe("cloak");
		expect(JSON.stringify(envelope.data).toLowerCase()).toContain("example domain");
	});
});

describe.skipIf(browserEnabled)("opt-in browser-mode smoke", () => {
	it("is skipped unless PI_SCRAPER_BROWSER=1", () => {
		expect(process.env.PI_SCRAPER_BROWSER).not.toBe("1");
	});
});
