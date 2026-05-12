/** @file Scrape-config-dispatch **tests** module. */
import { describe, expect, it } from "vitest";

import { parseScrapeConfigCommandArgs, runScrapeConfigCommand } from "../scrape-config.ts";

describe("parseScrapeConfigCommandArgs", () => {
	it("returns empty for no args (picker path)", () => {
		expect(parseScrapeConfigCommandArgs("")).toEqual({});
	});

	it("parses status action", () => {
		expect(parseScrapeConfigCommandArgs("status")).toEqual({ action: "status" });
	});

	it("parses model-provider with value", () => {
		expect(parseScrapeConfigCommandArgs("model-provider gemini-acp")).toEqual({
			action: "model-provider",
			provider: "gemini-acp",
		});
	});

	it("parses scrape-mode with mode and format", () => {
		expect(parseScrapeConfigCommandArgs("scrape-mode fast markdown")).toEqual({
			action: "scrape-mode",
			mode: "fast",
			format: "markdown",
		});
	});

	it("parses cache stats", () => {
		expect(parseScrapeConfigCommandArgs("cache stats")).toEqual({
			action: "cache",
			op: "stats",
			force: false,
		});
	});

	it("parses cache clear", () => {
		expect(parseScrapeConfigCommandArgs("cache clear")).toEqual({
			action: "cache",
			op: "clear",
			force: false,
		});
	});

	it("parses cache clear --force", () => {
		expect(parseScrapeConfigCommandArgs("cache clear --force")).toEqual({
			action: "cache",
			op: "clear",
			force: true,
		});
	});

	it("parses robots on", () => {
		expect(parseScrapeConfigCommandArgs("robots on")).toEqual({
			action: "robots",
			value: "on",
		});
	});

	it("parses robots off", () => {
		expect(parseScrapeConfigCommandArgs("robots off")).toEqual({
			action: "robots",
			value: "off",
		});
	});

	it("parses reload action", () => {
		expect(parseScrapeConfigCommandArgs("reload")).toEqual({ action: "reload" });
	});

	it("throws on unknown action", () => {
		expect(() => parseScrapeConfigCommandArgs("unknown")).toThrow(/.*/u);
	});
});

describe("runScrapeConfigCommand dispatch", () => {
	it("no-args + picker calls select and dispatches", async () => {
		let selectCalled = false;
		const ctx = {
			ui: {
				notify() {
					/* no-op */
				},
				async select(_title: string, choices: readonly string[]) {
					selectCalled = true;
					// "Status"
					return choices[0];
				},
			},
		};
		const result = await runScrapeConfigCommand({}, ctx);
		expect(selectCalled).toBe(true);
		expect(result.content[0]?.text).toContain("Scrape config status");
	});

	it("no-args without picker falls back to status", async () => {
		const result = await runScrapeConfigCommand({}, {});
		expect(result.content[0]?.text).toContain("Scrape config status");
	});

	it("cancels when picker returns undefined", async () => {
		const ctx = {
			ui: {
				notify() {
					/* no-op */
				},
				select: async (): Promise<string | undefined> => undefined,
			},
		};
		const result = await runScrapeConfigCommand({}, ctx);
		expect(result.content[0]?.text).toBe("Cancelled.");
	});

	it("dispatches reload action", async () => {
		const result = await runScrapeConfigCommand({ action: "reload" }, {});
		expect(result.content[0]?.text).toContain("Config reloaded");
		expect(result.content[0]?.text).toMatch(/mode=\w+/u);
	});
});
