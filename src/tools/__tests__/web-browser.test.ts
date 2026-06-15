/** @file Web_browser tool validation tests. */
import { describe, expect, it } from "vitest";

import type { ToolContext } from "../../types.ts";
import { webBrowserTool } from "../web-browser.ts";

describe("webBrowserTool validation", () => {
	const signal = new AbortController().signal;

	it("requires sessionId", async () => {
		const result = await webBrowserTool.execute(
			"test",
			{ action: "snapshot", sessionId: "" } as never,
			signal,
		);
		expect((result.details as ToolContext).error?.code).toBe("BROWSER_SESSION_MISSING");
	});

	it("requires url for navigate", async () => {
		const result = await webBrowserTool.execute(
			"test",
			{ action: "navigate", sessionId: "s1" } as never,
			signal,
		);
		expect((result.details as ToolContext).error?.code).toBe("BROWSER_URL_MISSING");
	});

	it("requires selector for click", async () => {
		const result = await webBrowserTool.execute(
			"test",
			{ action: "click", sessionId: "s1" } as never,
			signal,
		);
		expect((result.details as ToolContext).error?.code).toBe("BROWSER_SELECTOR_MISSING");
	});

	it("requires selector for fill", async () => {
		const result = await webBrowserTool.execute(
			"test",
			{ action: "fill", sessionId: "s1", value: "x" } as never,
			signal,
		);
		expect((result.details as ToolContext).error?.code).toBe("BROWSER_SELECTOR_MISSING");
	});

	it("requires selector for select", async () => {
		const result = await webBrowserTool.execute(
			"test",
			{ action: "select", sessionId: "s1", value: "x" } as never,
			signal,
		);
		expect((result.details as ToolContext).error?.code).toBe("BROWSER_SELECTOR_MISSING");
	});

	it("requires script for evaluate", async () => {
		const result = await webBrowserTool.execute(
			"test",
			{ action: "evaluate", sessionId: "s1" } as never,
			signal,
		);
		expect((result.details as ToolContext).error?.code).toBe("BROWSER_SCRIPT_MISSING");
	});

	it("requires sessionId for screenshot", async () => {
		const result = await webBrowserTool.execute(
			"test",
			{ action: "screenshot", sessionId: "" } as never,
			signal,
		);
		expect((result.details as ToolContext).error?.code).toBe("BROWSER_SESSION_MISSING");
	});

	it("requires sessionId for evaluate", async () => {
		const result = await webBrowserTool.execute(
			"test",
			{ action: "evaluate", sessionId: "", script: "1+1" } as never,
			signal,
		);
		expect((result.details as ToolContext).error?.code).toBe("BROWSER_SESSION_MISSING");
	});
});
