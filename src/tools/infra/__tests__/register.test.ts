/** @file Tools **tests** register.test module. */
import type {
	ExtensionAPI,
	ExtensionContext,
	SessionStartEvent,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import { createWebToolsLoader } from "../../web-tools.ts";
import type { WebTool } from "../define.ts";
import { registerWebTools, webTools } from "../register.ts";

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

	it("registers native definitions and starts Pi 0.81 with a lean catalog", async () => {
		const registered: ToolDefinition[] = [];
		let active = ["read"];
		type SessionStartHandler = (
			event: SessionStartEvent,
			context: ExtensionContext,
		) => void | Promise<void>;
		let sessionStart: SessionStartHandler | undefined;
		const pi = {
			registerTool(tool: ToolDefinition) {
				registered.push(tool);
				active.push(tool.name);
			},
			getActiveTools: () => [...active],
			getAllTools: () =>
				registered.map((tool) => ({ name: tool.name, description: tool.description })),
			setActiveTools(names: string[]) {
				active = [...names];
			},
			getFlag: () => undefined,
			on(_event: "session_start", handler: SessionStartHandler) {
				sessionStart = handler;
			},
		} as unknown as ExtensionAPI;

		await registerWebTools(pi);
		expect(registered.map((tool) => tool.name)).toEqual([...expectedNames, "web_tools"]);
		expect(registered[0]).not.toBe(webTools[0]);

		await sessionStart?.({ type: "session_start", reason: "startup" }, {} as ExtensionContext);
		expect(active).toEqual(["read", "web_scrape", "web_extract", "web_tools"]);
	});

	it.each([
		["crawl linked pages", "web_crawl"],
		["map robots and sitemaps", "web_map"],
		["batch many independent URLs", "web_batch"],
		["retrieve a stored job result", "web_get_result"],
		["click and fill a live browser page", "web_browser"],
	])("loads the expected specialized tool for %s", async (query, expectedTool) => {
		let active = ["web_scrape", "web_extract", "web_tools"];
		const pi = {
			getActiveTools: () => [...active],
			getAllTools: () =>
				webTools.map((tool) => ({ name: tool.name, description: tool.description })),
			setActiveTools(names: string[]) {
				active = [...names];
			},
		} as unknown as Pick<ExtensionAPI, "getActiveTools" | "getAllTools" | "setActiveTools">;
		const loader = createWebToolsLoader(pi);

		await loader.execute("loader-call", { query }, new AbortController().signal);

		expect(active[3]).toBe(expectedTool);
	});

	it("activates tools additively and leaves the active set unchanged for no match", async () => {
		let active = ["read", "web_scrape", "web_extract", "web_tools"];
		const pi = {
			getActiveTools: () => [...active],
			getAllTools: () =>
				webTools.map((tool) => ({ name: tool.name, description: tool.description })),
			setActiveTools(names: string[]) {
				active = [...names];
			},
		} as unknown as Pick<ExtensionAPI, "getActiveTools" | "getAllTools" | "setActiveTools">;
		const loader = createWebToolsLoader(pi);

		await loader.execute(
			"loader-call",
			{ query: "crawl linked pages", limit: 1 },
			new AbortController().signal,
		);
		await loader.execute(
			"loader-call",
			{ query: "map robots and sitemaps", limit: 1 },
			new AbortController().signal,
		);
		const loaded = [...active];
		await loader.execute(
			"loader-call",
			{ query: "compose a sonnet", limit: 1 },
			new AbortController().signal,
		);

		expect(loaded).toEqual([
			"read",
			"web_scrape",
			"web_extract",
			"web_tools",
			"web_crawl",
			"web_map",
		]);
		expect(active).toEqual(loaded);
	});
});
