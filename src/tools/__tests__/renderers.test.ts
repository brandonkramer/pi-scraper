import { afterEach, describe, expect, it, vi } from "vitest";
import type { RenderComponent, ToolRenderContext } from "../define.js";
import { progressShell } from "../progress.js";
import { toolResult } from "../result.js";
import { webBatchTool } from "../web-batch.js";
import { webCrawlTool } from "../web-crawl.js";
import { webCrawlsTool } from "../web-crawls.js";
import { webDiffTool } from "../web-diff.js";
import { webHistoryTool } from "../web-history.js";
import { webScrapeTool } from "../web-scrape.js";
import { webSearchScrapesTool } from "../web-search-scrapes.js";

const partialContext = {
	expanded: false,
	isPartial: true,
	state: {},
	invalidate: () => undefined,
} satisfies ToolRenderContext<never>;

afterEach(() => {
	vi.useRealTimers();
});

describe("web tool renderers", () => {
	it("shows loader and completion check for web_scrape calls", () => {
		const params = { url: "https://example.com", mode: "fast" as const };
		const loading = text(
			webScrapeTool.renderCall?.(params, undefined, partialContext as never),
		);
		const done = text(
			webScrapeTool.renderCall?.(params, undefined, { isPartial: false }),
		);

		expect(loading).toContain("web_scrape");
		expect(loading).toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/u);
		expect(done).toContain("✓ web_scrape");
	});

	it("stops spinner animation when invalidated", () => {
		vi.useFakeTimers();
		const requestRender = vi.fn();
		const component = webScrapeTool.renderCall?.(
			{ url: "https://example.com" },
			undefined,
			{
				expanded: false,
				isPartial: true,
				state: {},
				invalidate: requestRender,
			},
		);

		vi.advanceTimersByTime(240);
		expect(requestRender).toHaveBeenCalledTimes(2);

		component?.invalidate();
		vi.advanceTimersByTime(480);
		expect(requestRender).toHaveBeenCalledTimes(2);
	});

	it("renders web_scrape result checklists and width-safe lines", () => {
		const result = toolResult({
			text: "200 · fast · markdown\n# Example Domain",
			data: { markdown: "# Example Domain" },
			url: "https://example.com",
			status: 200,
			mode: "fast",
			format: "markdown",
			responseId: "r-scrape",
		});

		expect(
			text(webScrapeTool.renderResult?.(result, { expanded: false })),
		).toContain("✓ web_scrape 200");
		const expanded = text(
			webScrapeTool.renderResult?.(result, { expanded: true }),
		);
		expect(expanded).toContain("✓ URL validated");
		expect(expanded).toContain("✓ stored result");
		expect(
			widthSafe(webScrapeTool.renderResult?.(result, { expanded: true }), 32),
		).toBe(true);
	});

	it("renders progress checklist details", () => {
		const progress = progressShell({
			state: "loading",
			url: "https://example.com",
			checklist: [
				{ id: "validated", label: "URL validated", state: "done" },
				{ id: "fetch", label: "fetching page", state: "pending" },
			],
		});
		const rendered = text(
			webScrapeTool.renderResult?.(progress, { expanded: false }),
		);
		expect(rendered).toContain("⠋ web_scrape loading");
		expect(rendered).toContain("✓ URL validated");
		expect(rendered).toContain("☐ fetching page");
	});

	it("renders crawl checklist and counts", () => {
		const result = toolResult({
			text: "Crawl c1: 2 succeeded, 1 failed, 3 visited, frontier 0.",
			data: {
				metadata: {
					succeededCount: 2,
					failedCount: 1,
					visitedCount: 3,
					frontierCount: 0,
				},
			},
			responseId: "r-crawl",
		});
		const collapsed = text(
			webCrawlTool.renderResult?.(result, { expanded: false }),
		);
		const expanded = text(
			webCrawlTool.renderResult?.(result, { expanded: true }),
		);
		expect(collapsed).toContain("✓ web_crawl 2 succeeded");
		expect(expanded).toContain("✓ robots checked");
		expect(expanded).toContain("✓ crawl state saved");
	});

	it("renders batch succeeded, failed, and cache-hit counts", () => {
		const result = toolResult({
			text: "Batch scrape complete",
			data: [
				{
					ok: true,
					url: "https://a.test",
					result: { cache: { cached: true } },
				},
				{ ok: false, url: "https://b.test", error: { message: "blocked" } },
			],
			responseId: "r-batch",
		});
		const collapsed = text(
			webBatchTool.renderResult?.(result, { expanded: false }),
		);
		expect(collapsed).toContain("✓ 1 succeeded");
		expect(collapsed).toContain("✕ 1 failed");
		expect(collapsed).toContain("↻ 1 cache hits");
	});

	it("renders diff baseline, unchanged, and changed states", () => {
		const baseline = toolResult({
			text: "baseline",
			data: {},
			responseId: "r1",
		});
		const unchanged = toolResult({
			text: "unchanged",
			data: {
				previous: {},
				diff: { changedCount: 0, addedCount: 0, removedCount: 0 },
			},
			summary: "No content changes detected.",
		});
		const changed = toolResult({
			text: "changed",
			data: {
				previous: {},
				diff: { changedCount: 2, addedCount: 1, removedCount: 0 },
			},
		});

		expect(
			text(webDiffTool.renderResult?.(baseline, { expanded: false })),
		).toContain("✓ saved baseline");
		expect(
			text(webDiffTool.renderResult?.(unchanged, { expanded: false })),
		).toContain("✓ no content changes");
		expect(
			text(webDiffTool.renderResult?.(changed, { expanded: false })),
		).toContain("⚠ changed: 2 changed, 1 added, 0 removed");
	});

	it("renders DB lookup interpretation without loaders", () => {
		const history = toolResult({
			text: "Found records",
			data: { entries: [{ responseId: "r1" }] },
			qualitySignals: { freshness: "current" },
		});
		const crawls = toolResult({
			text: "Found crawls",
			data: { crawls: [{ recommendedAction: "recrawl" }] },
		});
		const search = toolResult({
			text: "hits",
			data: {
				supported: true,
				hits: [{ responseId: "r1" }, { responseId: "r2" }],
			},
		});

		expect(
			text(webHistoryTool.renderResult?.(history, { expanded: false })),
		).toContain("✓ reusable result found");
		expect(
			text(webCrawlsTool.renderResult?.(crawls, { expanded: false })),
		).toContain("⚠ recrawl recommended");
		expect(
			text(webSearchScrapesTool.renderResult?.(search, { expanded: false })),
		).toContain("✓ 2 stored hits");
	});
});

function text(component: RenderComponent | undefined): string {
	return component?.render(120).join("\n") ?? "";
}

function widthSafe(
	component: RenderComponent | undefined,
	width: number,
): boolean {
	return (
		component?.render(width).every((line) => line.length <= width) ?? false
	);
}
