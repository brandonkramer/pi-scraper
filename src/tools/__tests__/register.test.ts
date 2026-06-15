/** @file Tools **tests** register.test module. */
import { describe, expect, it } from "vitest";

import type { WebTool } from "../infra/define.ts";
import { registerWebTools, webTools } from "../infra/register.ts";

const expectedNames = [
	"web_scrape",
	"web_crawl",
	"web_map",
	"web_batch",
	"web_extract",
	"web_get_result",
	"web_browser",
];

describe("web tool registration", () => {
	it("exports all stable public web_ tools", () => {
		expect(webTools.map((tool) => tool.name)).toEqual(expectedNames);
		expect(webTools.every((tool) => tool.name.startsWith("web_"))).toBe(true);
	});

	it("registers each tool through the loop", async () => {
		const registered: WebTool[] = [];
		await registerWebTools({ registerTool: (tool: WebTool) => registered.push(tool) });
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
