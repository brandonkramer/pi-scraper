/**
 * @fileoverview web-config-dispatch __tests__ module.
 */
import { describe, expect, it } from "vitest";
import {
	parseWebConfigCommandArgs,
	runWebConfigCommand,
} from "../web-config.ts";

describe("parseWebConfigCommandArgs", () => {
	it("returns empty for no args (picker path)", () => {
		expect(parseWebConfigCommandArgs("")).toEqual({});
	});

	it("parses status action", () => {
		expect(parseWebConfigCommandArgs("status")).toEqual({ action: "status" });
	});

	it("parses model-provider with value", () => {
		expect(parseWebConfigCommandArgs("model-provider gemini-acp")).toEqual({
			action: "model-provider",
			provider: "gemini-acp",
		});
	});

	it("parses scrape-mode with mode and format", () => {
		expect(parseWebConfigCommandArgs("scrape-mode fast markdown")).toEqual({
			action: "scrape-mode",
			mode: "fast",
			format: "markdown",
		});
	});

	it("parses cache stats", () => {
		expect(parseWebConfigCommandArgs("cache stats")).toEqual({
			action: "cache",
			op: "stats",
			force: false,
		});
	});

	it("parses cache clear", () => {
		expect(parseWebConfigCommandArgs("cache clear")).toEqual({
			action: "cache",
			op: "clear",
			force: false,
		});
	});

	it("parses cache clear --force", () => {
		expect(parseWebConfigCommandArgs("cache clear --force")).toEqual({
			action: "cache",
			op: "clear",
			force: true,
		});
	});

	it("parses robots on", () => {
		expect(parseWebConfigCommandArgs("robots on")).toEqual({
			action: "robots",
			value: "on",
		});
	});

	it("parses robots off", () => {
		expect(parseWebConfigCommandArgs("robots off")).toEqual({
			action: "robots",
			value: "off",
		});
	});

	it("throws on unknown action", () => {
		expect(() => parseWebConfigCommandArgs("unknown")).toThrow();
	});
});

describe("runWebConfigCommand dispatch", () => {
	it("no-args + picker calls select and dispatches", async () => {
		let selectCalled = false;
		const ctx = {
			ui: {
				notify() {},
				async select(_title: string, choices: readonly string[]) {
					selectCalled = true;
					return choices[0]; // "Status"
				},
			},
		};
		const result = await runWebConfigCommand({}, ctx);
		expect(selectCalled).toBe(true);
		expect(result.content[0]?.text).toContain("Web config status");
	});

	it("no-args without picker falls back to status", async () => {
		const result = await runWebConfigCommand({}, {});
		expect(result.content[0]?.text).toContain("Web config status");
	});

	it("cancels when picker returns undefined", async () => {
		const ctx = {
			ui: {
				notify() {},
				async select() {
					return undefined;
				},
			},
		};
		const result = await runWebConfigCommand({}, ctx);
		expect(result.content[0]?.text).toBe("Cancelled.");
	});
});
