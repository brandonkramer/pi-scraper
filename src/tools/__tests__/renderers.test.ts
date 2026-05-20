/** @file Renderer contract tests for Pi web tool cards. */
import { describe, expect, it } from "vitest";

import { renderEnvelopeResult } from "../../tui/envelope.ts";
import type { RenderComponent } from "../../tui/types.ts";
import type { ToolRenderContext } from "../infra/define.ts";
import { progressShell } from "../infra/progress.ts";
import { toolResult } from "../infra/result.ts";
import { webBatchTool } from "../web-batch.ts";
import { webCrawlTool } from "../web-crawl.ts";
import { webScrapeTool } from "../web-scrape.ts";

const partialContext = {
	expanded: false,
	isPartial: true,
	state: {},
	invalidate: () => {
		/* no-op */
	},
} satisfies ToolRenderContext<never>;

describe("web tool renderers", () => {
	it("renders web_scrape calls without loader or title check", () => {
		const params = { url: "https://example.com", mode: "fast" as const };
		const loading = text(webScrapeTool.renderCall?.(params, undefined, partialContext as never));
		const done = text(webScrapeTool.renderCall?.(params, undefined, { isPartial: false }));

		expect(loading).toContain("web_scrape");
		expect(loading).not.toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/u);
		expect(done).toContain("web_scrape");
		expect(done).not.toContain("https://example.com");
		expect(done).not.toContain("✓ web_scrape");
	});

	it("renders web_scrape result rows and width-safe expanded details", () => {
		const result = toolResult({
			text: "200 · fast · markdown\n# Example Domain",
			data: { title: "Example Domain", markdown: "# Example Domain" },
			url: "https://example.com",
			status: 200,
			mode: "fast",
			format: "markdown",
			responseId: "r-scrape",
		});

		const collapsed = text(webScrapeTool.renderResult?.(result, { expanded: false }));
		expect(collapsed).not.toContain("web_scrape · 1/1 done");
		expect(collapsed).not.toContain("ok 1");
		expect(collapsed).not.toContain("err 0");
		expect(collapsed).toContain("done");
		expect(collapsed).toContain("200");
		expect(collapsed).toContain("(ctrl+o to expand)");
		expect(collapsed).not.toContain("✓ web_scrape");
		const expanded = text(webScrapeTool.renderResult?.(result, { expanded: true }));
		expect(expanded).toContain("page");
		expect(expanded).toContain("Example Domain");
		expect(expanded).toContain("responseId: r-scrape");
		expect(terminalWidthSafe(webScrapeTool.renderResult?.(result, { expanded: true }), 48)).toBe(
			true,
		);
	});

	it("renders scrape progress as row card with checklist", () => {
		const progress = progressShell({
			state: "loading",
			url: "https://example.com",
			checklist: [
				{ id: "validated", label: "URL validated", state: "done" },
				{ id: "fetch", label: "fetching page", state: "pending" },
			],
		});
		const rendered = text(webScrapeTool.renderResult?.(progress, { expanded: false }));
		expect(rendered).toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] https:\/\/example\.com/u);
		expect(rendered).toContain("loading");
		expect(rendered).toContain("web_scrape loading");
		const expanded = text(webScrapeTool.renderResult?.(progress, { expanded: true }));
		expect(expanded).toContain("URL validated");
		expect(expanded).toContain("fetching page");
		expect(expanded).not.toContain("✓ URL validated");
	});

	it("renders crawl row list and counts like batch", () => {
		const result = toolResult({
			text: "Crawl c1: 2 succeeded, 1 failed, 3 visited, frontier 0.",
			data: {
				metadata: {
					succeededCount: 2,
					failedCount: 1,
					visitedCount: 3,
					frontierCount: 0,
				},
				pages: [
					{ ok: true, url: "https://a.test", status: 200, mode: "fast" },
					{ ok: true, url: "https://b.test", status: 200, mode: "fast" },
					{
						ok: false,
						url: "https://c.test",
						error: { code: "BLOCKED", phase: "fetch", message: "blocked" },
					},
				],
			},
			responseId: "r-crawl",
		});
		const doneTitle = text(
			webCrawlTool.renderCall?.({ url: "https://example.com", maxPages: 1 }, undefined, {
				isPartial: false,
			}),
		);
		const collapsed = text(webCrawlTool.renderResult?.(result, { expanded: false }));
		const expanded = text(webCrawlTool.renderResult?.(result, { expanded: true }));
		expect(doneTitle).toContain("web_crawl https://example.com max 1");
		expect(doneTitle).not.toContain("✓ web_crawl");
		expect(collapsed).toContain("✓ 2 succeeded");
		expect(collapsed).toContain("✕ 1 failed");
		expect(collapsed).toContain("◉ 3 visited");
		expect(collapsed).toContain("→ frontier 0");
		expect(collapsed).toContain("done");
		expect(collapsed).toContain("error");
		expect(collapsed).not.toContain("✓ web_crawl");
		expect(expanded).toContain("Per-page details:");
		expect(expanded).toContain("BLOCKED · fetch · blocked");
	});

	it("fills collapsed crawl result width after frontier count", () => {
		const result = toolResult({
			text: "Crawl c1: 1 succeeded, 0 failed, 1 visited, frontier 0.",
			data: {
				metadata: {
					succeededCount: 1,
					failedCount: 0,
					visitedCount: 1,
					frontierCount: 0,
				},
			},
			responseId: "369cd692-91a6-4348-906b-ce493c8696d8",
		});
		const component = webCrawlTool.renderResult?.(result, { expanded: false });

		expect(terminalWidthFilled(component, 116)).toBe(true);
	});

	it("renders batch succeeded, failed, and cache-hit counts", () => {
		const result = toolResult({
			text: "Batch scrape complete",
			data: [
				{
					ok: true,
					url: "https://a.test",
					result: {
						status: 200,
						mode: "fast",
						format: "markdown",
						cache: { cached: true },
						data: { title: "A Test", text: "Useful batch content." },
					},
				},
				{
					ok: false,
					url: "https://b.test",
					error: { code: "BLOCKED", phase: "fetch", message: "blocked" },
				},
			],
			responseId: "r-batch",
		});
		const doneTitle = text(
			webBatchTool.renderCall?.({ urls: ["https://a.test", "https://b.test"] }, undefined, {
				isPartial: false,
			}),
		);
		const collapsed = text(webBatchTool.renderResult?.(result, { expanded: false }));
		expect(doneTitle).toContain("web_batch 2 urls");
		expect(doneTitle).not.toContain("✓ web_batch");
		expect(collapsed).toContain("✓ 1 succeeded");
		expect(collapsed).toContain("✕ 1 failed");
		expect(collapsed).toContain("↻ 1 cache hits");
		const expanded = text(webBatchTool.renderResult?.(result, { expanded: true }));
		expect(expanded).toContain("format");
		expect(expanded).toContain("markdown");
		expect(expanded).toContain("A Test");
		expect(expanded).toContain("BLOCKED");
		expect(expanded).toContain("blocked");
	});

	it("renders batch progress rows during partial updates", () => {
		const progress = progressShell({
			state: "processing",
			current: 1,
			total: 3,
			data: {
				batchProgress: {
					total: 3,
					completed: 1,
					succeeded: 1,
					failed: 0,
					concurrency: 2,
					items: [
						{ url: "https://a.test", status: "done" },
						{ url: "https://b.test", status: "processing" },
						{ url: "https://c.test", status: "queued" },
					],
				},
			},
		});
		const rendered = text(webBatchTool.renderResult?.(progress, { expanded: false }));

		expect(rendered).toContain("done");
		expect(rendered).toContain("1/3 done");
		expect(rendered).toContain("ok 1");
		expect(rendered).toContain("err 0");
		expect(rendered).toContain("concurrency 2");
		expect(rendered).toContain("done");
		expect(rendered).toContain("loading");
		expect(rendered).toContain("waiting");
	});

	it("keeps collapsed batch result within terminal width with emoji icons", () => {
		const result = toolResult({
			text: "Batch scrape complete",
			data: [{ ok: true, url: "https://a.test" }],
			responseId: "8c943bba-de19-472e-9",
		});
		const component = webBatchTool.renderResult?.(result, { expanded: false });

		expect(terminalWidthSafe(component, 116)).toBe(true);
	});

	it("preserves card backgrounds when a theme emits full resets", () => {
		const result = toolResult({
			text: "Batch scrape complete",
			data: [{ ok: true, url: "https://a.test" }],
		});
		const collapsed = text(
			webBatchTool.renderResult?.(
				result,
				{ expanded: false },
				{ fg: (_name, value) => `\u001B[35m${value}\u001B[0m` },
			),
		);

		expect(collapsed).not.toContain("\u001B[0m");
		expect(collapsed).toContain("\u001B[35m✕ 0 failed\u001B[39m");
		expect(collapsed).toContain("\u001B[35m↻ 0 cache hits\u001B[39m");
	});

	it("uses failed icon and color even when failed count is zero", () => {
		const result = toolResult({
			text: "Batch scrape complete",
			data: [{ ok: true, url: "https://a.test" }],
		});
		const collapsed = text(webBatchTool.renderResult?.(result, { expanded: false }));

		expect(collapsed).toContain("✕ 0 failed");
		expect(collapsed).toContain("↻ 0 cache hits");
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

		expect(text(webBatchTool.renderResult?.(batch, { expanded: false }))).toContain("0 succeeded");
		expect(text(webCrawlTool.renderResult?.(crawl, { expanded: false }))).toContain("0 succeeded");
	});

	it("renders diff baseline, unchanged, and changed states", () => {
		const baseline = toolResult({
			text: "baseline",
			data: {},
			responseId: "r1",
			kind: "diff",
		});
		const unchanged = toolResult({
			text: "unchanged",
			data: {
				previous: {},
				diff: { changedCount: 0, addedCount: 0, removedCount: 0 },
			},
			summary: "No content changes detected.",
			kind: "diff",
		});
		const changed = toolResult({
			text: "changed",
			data: {
				previous: {},
				diff: { changedCount: 2, addedCount: 1, removedCount: 0 },
			},
			kind: "diff",
		});

		expect(text(webScrapeTool.renderResult?.(baseline, { expanded: false }))).toContain(
			"saved baseline",
		);
		expect(text(webScrapeTool.renderResult?.(unchanged, { expanded: false }))).toContain(
			"no content changes",
		);
		expect(text(webScrapeTool.renderResult?.(changed, { expanded: false }))).toContain(
			"changed: 2 changed, 1 added, 0 removed",
		);
		expect(text(webScrapeTool.renderResult?.(changed, { expanded: false }))).not.toContain(
			"⚠ changed",
		);
	});

	it("keeps generic done descriptions icon-free", () => {
		const result = toolResult({
			text: "ok",
			data: {},
			url: "https://example.com",
		});

		expect(text(renderEnvelopeResult(result, false))).toContain("done · https://example.com");
		expect(text(renderEnvelopeResult(result, false))).not.toContain("✓ done");
	});
});

function text(component: RenderComponent | undefined): string {
	return component?.render(120).join("\n") ?? "";
}

function terminalWidthSafe(component: RenderComponent | undefined, width: number): boolean {
	return component?.render(width).every((line) => terminalVisibleWidth(line) <= width) ?? false;
}

function terminalWidthFilled(component: RenderComponent | undefined, width: number): boolean {
	return component?.render(width).every((line) => terminalVisibleWidth(line) === width) ?? false;
}

function terminalVisibleWidth(value: string): number {
	// eslint-disable-next-line no-control-regex -- ANSI CSI escape sequence
	const stripped = value.replaceAll(/\u001B\[[0-?]*[ -/]*[@-~]/gu, "");
	let width = 0;
	for (const char of stripped) {
		width += emojiOrWideCharPattern.test(char) ? 2 : 1;
	}
	return width;
}

const emojiOrWideCharPattern =
	/[⚠]|[\u{1100}-\u{115F}\u{2E80}-\u{A4CF}\u{AC00}-\u{D7A3}\u{F900}-\u{FAFF}\u{FE10}-\u{FE6F}\u{FF00}-\u{FFE6}]/u;
