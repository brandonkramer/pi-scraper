/** @file Renderer contract tests for Pi web tool cards. */
import { describe, expect, it } from "vitest";

import { signal } from "../../tools/__tests__/fixtures.ts";
import type { ToolRenderContext } from "../../tools/infra/define.ts";
import { progressShell } from "../../tools/infra/progress.ts";
import { toolResult } from "../../tools/infra/result.ts";
import { webBatchTool } from "../../tools/web-batch.ts";
import { webBrowserTool } from "../../tools/web-browser.ts";
import { webCrawlTool } from "../../tools/web-crawl.ts";
import { webExtractTool } from "../../tools/web-extract.ts";
import { webGetResultTool } from "../../tools/web-get-result.ts";
import { webScrapeTool } from "../../tools/web-scrape.ts";
import { toolCall, type RenderComponent, type RenderTheme } from "../index.ts";
import { renderWebBrowserResult } from "../renderers/browser.ts";
import { renderWebExtractResult } from "../renderers/extract.ts";
import { renderVerticalResult } from "../renderers/vertical.ts";

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
		expect(collapsed).toContain("\u001B[35m0 failed\u001B[39m");
		expect(collapsed).toContain("\u001B[35m0 cache hits\u001B[39m");
	});

	it("mutes failed and cache-hit segments when their counts are zero", () => {
		const result = toolResult({
			text: "Batch scrape complete",
			data: [{ ok: true, url: "https://a.test" }],
		});
		const collapsed = text(webBatchTool.renderResult?.(result, { expanded: false }));

		expect(collapsed).not.toContain("✕ 0 failed");
		expect(collapsed).not.toContain("↻ 0 cache hits");
		expect(collapsed).toContain("0 failed");
		expect(collapsed).toContain("0 cache hits");
	});

	it("omits toolSuccess icons when batch and crawl succeeded counts are zero", () => {
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

	it("keeps extract done descriptions icon-free", () => {
		const result = toolResult({
			text: "ok",
			data: {},
			url: "https://example.com",
		});

		expect(text(renderWebExtractResult(result, false))).toContain("done · https://example.com");
		expect(text(renderWebExtractResult(result, false))).not.toContain("✓ done");
	});

	it("renders extract progress without expanded result details", () => {
		const progress = progressShell({
			state: "processing",
			url: "https://example.com",
			message: "selector h1",
		});
		const rendered = text(renderWebExtractResult(progress, true));
		expect(rendered).toContain("web_extract processing");
		expect(rendered).toContain("selector h1");
		expect(rendered).not.toContain("_progress");
		expect(rendered).not.toContain("result");
	});

	it("renders extractor lists without expanded result metadata", () => {
		const result = toolResult({
			text: "2 extractor(s):\n- github_repo\n- npm",
			data: [{ name: "github_repo" }, { name: "npm" }],
			summary: "Listed deterministic extractor capabilities.",
		});

		const rendered = text(renderWebExtractResult(result, true));
		expect(rendered).toContain("Listed deterministic extractor capabilities.");
		expect(rendered).toContain("- github_repo");
		expect(rendered).toContain("- npm");
		expect(rendered).not.toContain("result");
		expect(rendered).not.toContain("response payload");
	});

	it("formats Stack Overflow question, body, and answers in expanded view", () => {
		const result = toolResult({
			text: "ok",
			data: {
				extractor: "stackoverflow",
				data: {
					title: "Why is conditional processing faster?",
					body: "<p>Branch prediction example</p>",
					score: 27535,
					viewCount: 1986373,
					answerCount: 26,
					tags: ["java", "performance"],
					answers: [
						{
							owner: "Mystical",
							body: "<p>Because branch prediction</p>",
							score: 40000,
							isAccepted: true,
						},
					],
					comments: [{ owner: "Reader", body: "Great question" }],
				},
			},
		});
		const rendered = text(renderVerticalResult(result, true));
		expect(rendered).toContain("question");
		expect(rendered).toContain("Branch prediction example");
		expect(rendered).toContain("answers");
		expect(rendered).toContain("Mystical");
		expect(rendered).toContain("Because branch prediction");
		expect(rendered).not.toContain("video");
		expect(rendered).not.toContain("\n  comments\n");
	});

	it("formats YouTube transcript continuations and comments as readable lists", () => {
		const result = toolResult({
			text: "ok",
			data: {
				extractor: "youtube",
				data: {
					title: "Video",
					transcript: {
						text: "long transcript",
						segments: [
							{
								start: 23,
								text: "♪ You know the rules and so do I, this line is intentionally long enough to wrap cleanly under the timestamp ♪",
							},
						],
					},
					comments: [
						{
							author: "@YouTube",
							text: "can confirm: he never gave us up",
						},
					],
				},
			},
		});
		const rendered = text(renderVerticalResult(result, true));
		expect(rendered).toContain("transcript");
		expect(rendered).toContain("0:23");
		expect(rendered).toContain("timestamp ♪");
		expect(rendered).toContain("comments");
		expect(rendered).toContain("@YouTube: can confirm: he never gave us up");
		expect(rendered).not.toContain("├─ 1");
	});

	it("formats Dev.to articles and comments in expanded view", () => {
		const result = toolResult({
			text: "ok",
			data: {
				extractor: "devto",
				data: {
					title: "Building a Dev.to Extractor",
					body: "# Building a Dev.to Extractor\n\nUse the Forem API.",
					bodyMarkdown: "# Building a Dev.to Extractor\n\nUse the Forem API.",
					tags: ["webdev", "api"],
					readablePublishedDate: "Jun 15",
					readingTimeMinutes: 4,
					commentsCount: 2,
					author: { name: "Jane Developer", username: "jane" },
					comments: [{ author: "Reader", username: "reader", bodyHtml: "<p>Great article.</p>" }],
					source: {
						provider: "devto",
						articleEndpoint: "https://dev.to/api/articles/jane/building-a-devto-extractor",
						commentsEndpoint: "https://dev.to/api/comments?a_id=12345",
					},
				},
			},
		});

		const rendered = text(renderVerticalResult(result, true));
		expect(rendered).toContain("article");
		expect(rendered).toContain("Jane Developer (@jane)");
		expect(rendered).toContain("4 min");
		expect(rendered).toContain("Use the Forem API");
		expect(rendered).toContain("Reader: Great article.");
		expect(rendered).toContain("articleEndpoint");
		expect(rendered).toContain("commentsEndpoint");
		expect(rendered).not.toContain("video");
	});

	it("formats Reddit posts and top comments in expanded view", () => {
		const result = toolResult({
			text: "ok",
			data: {
				extractor: "reddit",
				data: {
					title: "Reddit API changes",
					subreddit: "announcements",
					author: "reddit",
					selfText: "API update details.",
					score: 1200,
					upvoteRatio: 0.82,
					commentCount: 99,
					flairText: "Admin Post",
					topComments: [{ author: "octo", body: "Thanks for the details.", score: 7 }],
					source: {
						provider: "reddit",
						endpoint:
							"https://www.reddit.com/r/announcements/comments/14f4h6s.json?limit=50&raw_json=1",
					},
				},
			},
		});

		const rendered = text(renderVerticalResult(result, true));
		expect(rendered).toContain("post");
		expect(rendered).toContain("r/announcements");
		expect(rendered).toContain("82%");
		expect(rendered).toContain("API update details.");
		expect(rendered).toContain("top comments");
		expect(rendered).toContain("octo: Thanks for the details.");
		expect(rendered).not.toContain("video");
	});

	it("renders blocked vertical metadata without generic result details", () => {
		const result = toolResult({
			text: "reddit returned URL metadata only",
			data: {
				extractor: "reddit",
				data: {
					permalink: "https://www.reddit.com/r/programming/comments/1/hello_world/",
					source: {
						provider: "reddit",
						blocked: true,
						reason: "robots.txt disallows fetching structured endpoint",
						attemptedEndpoints: ["https://www.reddit.com/comments/1.json?limit=5"],
					},
				},
			},
			summary: "reddit returned URL metadata only",
		});
		const rendered = text(webExtractTool.renderResult?.(result, { expanded: true }));
		expect(rendered).toContain("reddit metadata only");
		expect(rendered).toContain("attempted endpoints");
		expect(rendered).toContain("https://www.reddit.com/comments/1.json?limit=5");
		expect(rendered).not.toContain("response payload");
		expect(rendered).not.toContain("result");
	});

	it("renders vertical extraction failure with code and underlying message", () => {
		const result = toolResult({
			text: "└─ ✕ reddit failed · EXTRACTION_FAILED",
			data: {
				extractor: "reddit",
				url: "https://www.reddit.com/r/programming/comments/zzz/nope/",
				error: {
					code: "EXTRACTION_FAILED",
					message: "page.evaluate: Execution context was destroyed",
					retryable: false,
				},
			},
			summary: "└─ ✕ reddit failed · EXTRACTION_FAILED",
		});
		const rendered = text(webExtractTool.renderResult?.(result, { expanded: true }));
		expect(rendered).toContain("reddit failed");
		expect(rendered).toContain("EXTRACTION_FAILED");
		expect(rendered).toContain("Execution context was destroyed");
	});

	it("shows generic vertical data when no specialized section matches", () => {
		const result = toolResult({
			text: "ok",
			data: {
				extractor: "npm",
				data: { name: "typescript", version: "5.9.3", summary: "typed JavaScript" },
			},
		});
		const rendered = text(renderVerticalResult(result, true));
		expect(rendered).toContain("data");
		expect(rendered).toContain("version");
		expect(rendered).toContain("5.9.3");
		expect(rendered).toContain("summary");
	});

	it("renders web_browser status line and a result tree in expanded view", () => {
		const result = toolResult({
			text: 'navigate → https://example.com\n\nbutton "Submit" [ref=e3]',
			data: {
				action: "navigate",
				url: "https://example.com",
				snapshot: 'button "Submit" [ref=e3]',
			},
			url: "https://example.com",
			status: 200,
			mode: "cloak",
			timing: { durationMs: 333 },
		});

		const collapsed = text(renderWebBrowserResult(result, false));
		expect(collapsed).toContain("navigate");
		expect(collapsed).toContain("200");
		expect(collapsed).toContain("cloak mode");
		expect(collapsed).toMatch(/~\d+ tok/u); // token estimate of the agent-facing text
		expect(collapsed).toContain("(ctrl+o to expand)");
		expect(collapsed).not.toContain("[ref=e3]"); // snapshot hidden until expanded

		const expanded = text(renderWebBrowserResult(result, true));
		expect(expanded).toContain("snapshot"); // snapshot rendered as a result tree
		expect(expanded).toContain("@e3"); // ref is the tree key
		expect(expanded).toContain('button "Submit"'); // role/name is the value
		expect(expanded).not.toContain("backend"); // metadata not repeated (already on status line)
		expect(expanded).not.toContain("(ctrl+o to expand)");
		expect(terminalWidthSafe(renderWebBrowserResult(result, true), 48)).toBe(true);
	});

	it("shows a loading bar with the URL while navigating, bare header otherwise", () => {
		const params = { action: "navigate" as const, sessionId: "s1", url: "https://example.com" };
		const loading = text(webBrowserTool.renderCall?.(params, undefined, partialContext as never));
		expect(loading).toContain("web_browser");
		expect(loading).toContain("navigate");
		expect(loading).toContain("https://example.com"); // url visible during the load

		const done = text(webBrowserTool.renderCall?.(params, undefined, { isPartial: false }));
		expect(done).toContain("web_browser");
		expect(done).not.toContain("https://example.com"); // header omits url; the result bar carries it
	});

	it("renders web_browser screenshot image facts (path/type+dims/size/mode), no 'No snapshot.'", () => {
		const result = toolResult({
			text: "screenshot → https://example.com [viewport] saved: /blobs/3b/x.png",
			data: {
				action: "screenshot",
				url: "https://example.com",
				blobPath: "/blobs/3b/x.png",
				byteLength: 1234,
				width: 1280,
				height: 720,
				fullPage: false,
			},
			url: "https://example.com",
			mode: "cloak",
			timing: { durationMs: 80 },
		});

		const expanded = text(renderWebBrowserResult(result, true));
		expect(expanded).toContain("image");
		expect(expanded).toContain("/blobs/3b/x.png");
		expect(expanded).toContain("image/png · 1280×720");
		expect(expanded).toContain("1.2 KB");
		expect(expanded).toContain("viewport");
		expect(expanded).not.toContain("No snapshot.");
		expect(expanded).not.toContain("No details.");
	});

	it("renders web_browser evaluate result in expanded view", () => {
		const result = toolResult({
			text: 'evaluate → https://example.com\n\n"hello"',
			data: { action: "evaluate", url: "https://example.com", result: '"hello"', truncated: false },
			url: "https://example.com",
			mode: "cloak",
			timing: { durationMs: 8 },
		});

		const expanded = text(renderWebBrowserResult(result, true));
		expect(expanded).toContain("result");
		expect(expanded).toContain('"hello"');
		// "truncated" row is dropped when false.
		expect(expanded).not.toContain("truncated");
	});

	it("renders compact web_extract calls and expanded results", async () => {
		const result = await webExtractTool.execute("call", { action: "list" }, signal);
		expect(text(webExtractTool.renderCall?.({ action: "list" }, undefined))).toBe(
			"web_extract list",
		);
		expect(text(webExtractTool.renderResult?.(result, { expanded: true }, undefined))).toContain(
			"extractor",
		);
	});

	it("renders web_get_result collapsed status for found and missing results", async () => {
		const missingResult = await webGetResultTool.execute("call", { jobId: "missing-job" }, signal);
		expect(missingResult.isError).toBe(true);

		const theme: RenderTheme = {
			fg: (name, value) => `<fg:${name}>${value}</fg:${name}>`,
			bg: (name, value) => `<bg:${name}>${value}</bg:${name}>`,
		};
		const found = text(
			webGetResultTool.renderResult?.(
				{
					content: [{ type: "text", text: "Stored result abc: 1 field" }],
					details: { data: { ok: true }, truncated: false },
				},
				{ expanded: false },
				theme,
			),
		);
		const missing = text(
			webGetResultTool.renderResult?.(
				{
					content: [{ type: "text", text: "missing" }],
					details: {
						truncated: false,
						error: {
							code: "STORED_RESULT_NOT_FOUND",
							phase: "retrieve",
							message: "missing",
							retryable: false,
						},
					},
				},
				{ expanded: false },
				theme,
			),
		);

		expect(found).toContain("<fg:accent>✓ result found</fg:accent>");
		expect(missing).toContain("<bg:toolErrorBg>");
		expect(missing).toContain("✕ no result");
	});

	it("wraps long custom renderer lines to the requested terminal width", () => {
		const lines = toolCall("x".repeat(150), []).render(40);
		expect(lines.length).toBeGreaterThan(1);
		expect(lines.every((line) => line.length <= 40)).toBe(true);
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
