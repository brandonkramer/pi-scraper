import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/** @file Scrape-config-model-provider **tests** module. */
import { describe, expect, it } from "vitest";

import { runScrapeConfigModelProvider } from "../scrape-config-model-provider.ts";

describe("runScrapeConfigModelProvider", () => {
	it("direct value sets config and reports", async () => {
		const rootDir = await mkdtemp(path.join(tmpdir(), "pi-scraper-cmd-"));
		const result = await runScrapeConfigModelProvider(
			{ action: "model-provider", provider: "auto" },
			{},
			{ rootDir },
		);
		expect(result.content[0]?.text).toContain("auto");
		await rm(rootDir, { recursive: true, force: true });
	});

	it("picker selects off and reports", async () => {
		const rootDir = await mkdtemp(path.join(tmpdir(), "pi-scraper-cmd-"));
		const ctx = {
			ui: {
				notify() {
					/* no-op */
				},
				async select(_title: string, choices: readonly string[]) {
					return choices.find((c) => c === "Off");
				},
			},
		};
		const result = await runScrapeConfigModelProvider({ action: "model-provider" }, ctx, {
			rootDir,
		});
		expect(result.content[0]?.text).toContain("off");
		await rm(rootDir, { recursive: true, force: true });
	});

	it("no picker returns error hint", async () => {
		const result = await runScrapeConfigModelProvider({ action: "model-provider" }, {});
		expect(result.content[0]?.text).toContain("Interactive picker unavailable");
	});
});
