/** @file Scrape-config-scrape-mode **tests** module. */
import { describe, expect, it } from "vitest";

import { runScrapeConfigScrapeMode } from "../scrape-config-scrape-mode.ts";

describe("runScrapeConfigScrapeMode", () => {
	it("direct args set mode and format", async () => {
		const result = await runScrapeConfigScrapeMode(
			{ action: "scrape-mode", mode: "auto", format: "markdown" },
			{},
		);
		expect(result.content[0]?.text).toContain("auto");
		expect(result.content[0]?.text).toContain("markdown");
	});

	it("picker selects mode and format", async () => {
		const ctx = {
			ui: {
				notify() {
					/* no-op */
				},
				async select(_title: string, choices: readonly string[]) {
					return choices[0];
				},
			},
		};
		const result = await runScrapeConfigScrapeMode({ action: "scrape-mode" }, ctx);
		expect(result.content[0]?.text).toContain("fast");
		expect(result.content[0]?.text).toContain("markdown");
	});

	it("no picker returns error hint", async () => {
		const result = await runScrapeConfigScrapeMode({ action: "scrape-mode" }, {});
		expect(result.content[0]?.text).toContain("Interactive picker unavailable");
	});
});
