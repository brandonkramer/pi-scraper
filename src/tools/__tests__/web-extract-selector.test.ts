/** @file Tools **tests** web-extract-selector.test module. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runSelectorExtractionTool } from "../web-extract-selector.ts";

let homeDir: string;
let originalHome: string | undefined;

beforeEach(async () => {
	homeDir = await mkdtemp(path.join(tmpdir(), "pi-scraper-selector-"));
	originalHome = process.env.HOME;
	process.env.HOME = homeDir;
});

afterEach(async () => {
	if (originalHome === undefined) delete process.env.HOME;
	else process.env.HOME = originalHome;
	await rm(homeDir, { recursive: true, force: true });
});

describe("web_extract action=selector", () => {
	it("extracts matching CSS selectors from content", async () => {
		const result = await runSelectorExtractionTool(
			{
				action: "selector",
				selector: ".product-card",
				selectorType: "css",
				content:
					"\u003Chtml\u003E\u003Cbody\u003E\u003Cdiv class='product-card'\u003E\u003Ch2\u003EProduct 1\u003C/h2\u003E\u003C/div\u003E\u003C/div\u003E\u003C/body\u003E\u003C/html\u003E",
				identifier: "test-products",
				autoSave: false,
				adaptive: false,
				threshold: 0.35,
			},
			{},
			new AbortController().signal,
		);

		expect(result.content[0]?.text).toContain("Product 1");
		expect(result.details?.data?.strategy).toBe("direct");
		expect(result.details?.data?.directMatches).toBe(1);
	});

	it("saves fingerprint with autoSave", async () => {
		const content =
			"\u003Chtml\u003E\u003Cbody\u003E\u003Cdiv class='card'\u003E\u003Ch2\u003EProduct 1\u003C/h2\u003E\u003C/div\u003E\u003C/body\u003E\u003C/html\u003E";

		// First call with autoSave
		const first = await runSelectorExtractionTool(
			{
				action: "selector",
				selector: ".card",
				selectorType: "css",
				content,
				identifier: "autosave-test",
				autoSave: true,
				adaptive: false,
				threshold: 0.35,
			},
			{},
			new AbortController().signal,
		);

		expect(first.details?.data?.saved).toBe(true);

		// Second call with adaptive + changed content
		const second = await runSelectorExtractionTool(
			{
				action: "selector",
				selector: ".card",
				selectorType: "css",
				content:
					"\u003Chtml\u003E\u003Cbody\u003E\u003Cdiv class='wrapper'\u003E\u003Cdiv class='new-card'\u003E\u003Ch2\u003EProduct 1\u003C/h2\u003E\u003C/div\u003E\u003C/div\u003E\u003C/body\u003E\u003C/html\u003E",
				identifier: "autosave-test",
				autoSave: false,
				adaptive: true,
				threshold: 0.3,
			},
			{},
			new AbortController().signal,
		);

		expect(second.details?.data?.strategy).toBe("adaptive");
		expect(second.details?.data?.score).toBeGreaterThan(0.3);
		expect(second.content[0]?.text).toContain("Product 1");
	});

	it("returns structured none when selector doesn't match", async () => {
		const result = await runSelectorExtractionTool(
			{
				action: "selector",
				selector: ".does-not-exist",
				selectorType: "css",
				content: ".product-card\u003Eh2\u003EProduct 1\u003C/h2\u003E\u003C/div\u003E",
				identifier: "no-match-test",
				adaptive: false,
				autoSave: false,
				threshold: 0.35,
			},
			{},
			new AbortController().signal,
		);

		expect(result.details?.data?.strategy).toBe("none");
		expect(result.details?.data?.directMatches).toBe(0);
		expect(result.details?.data?.adaptiveMatches).toBe(0);
	});

	it("errors when selector is missing", async () => {
		const result = await runSelectorExtractionTool(
			{
				action: "selector",
				identifier: "missing-test",
			},
			{},
			new AbortController().signal,
		);

		expect(result.details?.error?.code).toBe("SELECTOR_INPUT_MISSING");
	});

	it("handles text selector", async () => {
		const result = await runSelectorExtractionTool(
			{
				action: "selector",
				selector: "Product 1",
				selectorType: "text",
				content:
					"\u003Chtml\u003E\u003Cbody\u003E\u003Cdiv\u003E\u003Ch2\u003EProduct 1\u003C/h2\u003E\u003C/div\u003E\u003C/body\u003E\u003C/html\u003E",
				identifier: "text-test",
				autoSave: false,
				adaptive: false,
				threshold: 0.35,
			},
			{},
			new AbortController().signal,
		);

		expect(result.details?.data?.strategy).toBe("direct");
		expect(result.content[0]?.text).toContain("Product 1");
	});
});
