/** @file Unit coverage for named tool TUI components. */
import { describe, expect, it } from "vitest";

import {
	toolCall,
	toolResourceStatus,
	toolResultId,
	toolResultTree,
	toolStatus,
	type RenderTheme,
} from "../index.ts";
import { toolProgressLayout } from "../tool-progress.ts";
import { buildToolResultTree } from "../tool-result-tree.ts";
import { countSegments } from "../tool-status.ts";

const theme: RenderTheme = {
	fg: (name, text) => `<fg:${name}>${text}\u001B[39m`,
	bg: (name, text) => `<bg:${name}>${text}\u001B[49m`,
};

describe("tool TUI components", () => {
	it("renders a themed tool call header", () => {
		const rendered = toolCall("web_scrape", ["(auto → markdown)"], theme).render(80).join("\n");
		expect(rendered).toContain("<fg:accent>web_scrape (auto → markdown)\u001B[39m");
	});

	it("rebuilds themed tool-call text after invalidation", () => {
		let accent = "accent-a";
		const liveTheme: RenderTheme = {
			fg: (name, text) => `<fg:${name}:${accent}>${text}\u001B[39m`,
		};
		const component = toolCall("web_extract", ["vertical"], liveTheme);
		expect(component.render(80).join("\n")).toContain("<fg:accent:accent-a>");
		accent = "accent-b";
		component.invalidate();
		expect(component.render(80).join("\n")).toContain("<fg:accent:accent-b>");
	});

	it("renders status and tally segments", () => {
		const status = toolStatus([countSegments.success(2, "succeeded", theme), "markdown"], theme);
		expect(status).toContain("✓ 2 succeeded");
		expect(status).toContain("markdown");
	});

	it("restores surrounding tool-box bg after a loader pill", () => {
		const row = toolResourceStatus({
			url: "https://example.com",
			state: "error",
			width: 80,
			theme,
			restoreBg: "toolSuccessBg",
		});
		expect(row).toContain("<bg:toolErrorBg>");
		expect(row.endsWith("<bg:toolSuccessBg>")).toBe(true);
	});

	it("does not add trailing blank lines to result cards without summaries", () => {
		const rendered = toolProgressLayout({ renderContent: () => "done" }).render(20);
		expect(rendered).toEqual(["done".padEnd(20)]);
	});

	it("renders result tree groups and ids", () => {
		const tree = toolResultTree(
			buildToolResultTree([{ name: "details", rows: [["status", "200"]] }]),
			80,
			theme,
		);
		expect(tree).toContain("details");
		expect(tree).toContain("status");
		expect(toolResultId([{ label: "responseId", id: "r1" }], theme).join("\n")).toContain(
			"responseId: r1",
		);
	});

	it("normalizes multiline result tree values before wrapping", () => {
		const tree = toolResultTree(
			buildToolResultTree([
				{
					name: "page",
					rows: [["description", "First line\n      second line\n\nthird line"]],
				},
			]),
			80,
			theme,
		);
		expect(tree).toContain("First line second line third line");
		expect(tree).not.toContain("\n      second line");
	});
});
