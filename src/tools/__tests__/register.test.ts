import { describe, expect, it } from "vitest";
import type { WebTool } from "../define.js";
import { registerWebTools, webTools } from "../register.js";

const expectedNames = [
	"web_scrape",
	"web_crawl",
	"web_map",
	"web_batch",
	"web_brand",
	"web_diff",
	"web_list_extractors",
	"web_vertical_scrape",
	"web_extract",
	"web_summarize",
	"web_get_result",
];

describe("web tool registration", () => {
	it("exports all stable public web_ tools", () => {
		expect(webTools.map((tool) => tool.name)).toEqual(expectedNames);
		expect(webTools.every((tool) => tool.name.startsWith("web_"))).toBe(true);
	});

	it("registers each tool through the loop", () => {
		const registered: WebTool[] = [];
		registerWebTools({ registerTool: (tool) => registered.push(tool) });
		expect(registered.map((tool) => tool.name)).toEqual(expectedNames);
	});

	it("keeps schemas, execute handlers, and renderers colocated", () => {
		for (const tool of webTools) {
			expect(tool.parameters).toBeTruthy();
			expect(tool.execute).toBeTypeOf("function");
			expect(tool.renderCall).toBeTypeOf("function");
			expect(tool.renderResult).toBeTypeOf("function");
		}
	});
});
