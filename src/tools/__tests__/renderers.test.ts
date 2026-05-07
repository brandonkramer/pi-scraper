import { describe, expect, it } from "vitest";
import type { RenderComponent, ToolRenderContext } from "../define.js";
import { progressShell } from "../progress.js";
import { renderEnvelopeResult } from "../render.js";
import { toolResult } from "../result.js";
import { webBatchTool } from "../web-batch.js";
import { webCrawlTool } from "../web-crawl.js";
import { webDiffTool } from "../web-diff.js";
import { webScrapeTool } from "../web-scrape.js";

const partialContext = {
	expanded: false,
	isPartial: true,
	state: {},
	invalidate: () => undefined,
} satisfies ToolRenderContext<never>;

describe("web tool renderers", () => {
	it("renders web_scrape calls without loader or title check", () => {
		const params = { url: "https://example.com", mode: "fast" as const };
		const loading = text(
			webScrapeTool.renderCall?.(params, undefined, partialContext as never),
		);
		const done = text(
			webScrapeTool.renderCall?.(params, undefined, { isPartial: false }),
		);

		expect(loading).toContain("web_scrape");
		expect(loading).not.toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/u);
		expect(done).toContain("web_scrape");
		expect(done).not.toContain("✓ web_scrape");
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
		).toContain("web_scrape 200");
		expect(
			text(webScrapeTool.renderResult?.(result, { expanded: false })),
		).not.toContain("✓ web_scrape");
		const expanded = text(
			webScrapeTool.renderResult?.(result, { expanded: true }),
		);
		expect(expanded).toContain("URL validated");
		expect(expanded).toContain("stored result");
		expect(expanded).not.toContain("✓ URL validated");
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
		expect(rendered).toContain("web_scrape loading");
		expect(rendered).not.toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/u);
		expect(rendered).toContain("URL validated");
		expect(rendered).toContain("fetching page");
		expect(rendered).not.toContain("✓ URL validated");
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
		const doneTitle = text(
			webCrawlTool.renderCall?.(
				{ url: "https://example.com", maxPages: 1 },
				undefined,
				{ isPartial: false },
			),
		);
		const collapsed = text(
			webCrawlTool.renderResult?.(result, { expanded: false }),
		);
		const expanded = text(
			webCrawlTool.renderResult?.(result, { expanded: true }),
		);
		expect(doneTitle).toContain("web_crawl https://example.com max 1");
		expect(doneTitle).not.toContain("✓ web_crawl");
		expect(collapsed).toContain("✅ 2 succeeded");
		expect(collapsed).toContain("\u001B[38;2;239;118;122m❌ 1 failed\u001B[39m");
		expect(collapsed).toContain(
			"\u001B[38;2;199;211;111m🌐 3 visited\u001B[39m",
		);
		expect(collapsed).toContain(
			"\u001B[38;2;139;145;134m→ frontier 0\u001B[39m",
		);
		expect(collapsed).not.toContain("✓ web_crawl");
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
		const doneTitle = text(
			webBatchTool.renderCall?.(
				{ urls: ["https://a.test", "https://b.test"] },
				undefined,
				{ isPartial: false },
			),
		);
		const collapsed = text(
			webBatchTool.renderResult?.(result, { expanded: false }),
		);
		expect(doneTitle).toContain("web_batch 2 urls");
		expect(doneTitle).not.toContain("✓ web_batch");
		expect(collapsed).toContain("✅ 1 succeeded");
		expect(collapsed).toContain("❌ 1 failed");
		expect(collapsed).toContain("🔄 1 cache hits");
		expect(collapsed).toContain(
			"\u001B[38;2;199;211;111m🔄 1 cache hits\u001B[39m",
		);
	});

	it("uses failed icon and color even when failed count is zero", () => {
		const result = toolResult({
			text: "Batch scrape complete",
			data: [{ ok: true, url: "https://a.test" }],
		});
		const collapsed = text(
			webBatchTool.renderResult?.(result, { expanded: false }),
		);

		expect(collapsed).toContain("❌ 0 failed");
		expect(collapsed).toContain("\u001B[38;2;239;118;122m❌ 0 failed\u001B[39m");
		expect(collapsed).toContain("🔄 0 cache hits");
		expect(collapsed).toContain(
			"\u001B[38;2;199;211;111m🔄 0 cache hits\u001B[39m",
		);
	});

	it("omits success icons when batch and crawl succeeded counts are zero", () => {
		const batch = toolResult({
			text: "Batch scrape failed",
			data: [{ ok: false, url: "https://b.test" }],
		});
		const crawl = toolResult({
			text: "Crawl c1: 0 succeeded, 1 failed, 1 visited, frontier 0.",
			data: {
				metadata: {
					succeededCount: 0,
					failedCount: 1,
					visitedCount: 1,
					frontierCount: 0,
				},
			},
		});

		expect(
			text(webBatchTool.renderResult?.(batch, { expanded: false })),
		).toContain("\u001B[38;2;139;145;134m0 succeeded\u001B[39m");
		expect(
			text(webCrawlTool.renderResult?.(crawl, { expanded: false })),
		).toContain("\u001B[38;2;139;145;134m0 succeeded\u001B[39m");
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
		).toContain("saved baseline");
		expect(
			text(webDiffTool.renderResult?.(unchanged, { expanded: false })),
		).toContain("no content changes");
		expect(
			text(webDiffTool.renderResult?.(changed, { expanded: false })),
		).toContain("changed: 2 changed, 1 added, 0 removed");
		expect(
			text(webDiffTool.renderResult?.(changed, { expanded: false })),
		).not.toContain("⚠ changed");
	});

	it("keeps generic done descriptions icon-free", () => {
		const result = toolResult({
			text: "ok",
			data: {},
			url: "https://example.com",
		});

		expect(text(renderEnvelopeResult(result, false))).toContain(
			"done · https://example.com",
		);
		expect(text(renderEnvelopeResult(result, false))).not.toContain("✓ done");
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
