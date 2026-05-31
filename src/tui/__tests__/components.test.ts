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
import { toolResultCard } from "../tool-card.ts";
import { buildToolResultTree } from "../tool-result-tree.ts";
import { toolStatusMark } from "../tool-status.ts";

const theme: RenderTheme = {
	fg: (name, text) => `<fg:${name}>${text}\u001B[39m`,
	bg: (name, text) => `<bg:${name}>${text}\u001B[49m`,
};

describe("tool TUI components", () => {
	it("renders a themed tool call header", () => {
		const rendered = toolCall("web_scrape", ["(auto → markdown)"], theme).render(80).join("\n");
		expect(rendered).toContain("<fg:accent>web_scrape (auto → markdown)\u001B[39m");
	});

	it("renders status and tally segments", () => {
		const status = toolStatus(
			[toolStatusMark("success", 2, "succeeded", theme), "markdown"],
			theme,
		);
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
		const rendered = toolResultCard({ renderContent: () => "done" }).render(20);
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
});
