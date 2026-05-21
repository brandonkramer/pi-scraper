/** @file Tools **tests** web-tools.test module. */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { ModelAdapter, ModelRequest, ModelResponse } from "../../extract/adhoc/model.ts";
import type { ScrapePipelineDeps } from "../../scrape/pipeline.ts";
import { renderText } from "../../tui/text.ts";
import type { RenderComponent, RenderTheme } from "../../tui/types.ts";
import type { ResultEnvelope } from "../../types.ts";
import type { PiToolRegistrar, WebTool } from "../infra/define.ts";
import { registerWebTools } from "../infra/register.ts";
import { createWebExtractTool, webExtractTool } from "../web-extract.ts";
import { webGetResultTool } from "../web-get-result.ts";
import { createWebScrapeTool } from "../web-scrape.ts";

function summarizeOrExtractAdapter(request: ModelRequest): string | { ok: boolean } {
	return request.task === "summarize" ? "registered summary" : { ok: true };
}

function fixtureHeadingAdapter(request: ModelRequest): string {
	return request.input.includes("Fixture Heading")
		? "Summary from scraped page."
		: "Summary from provided content.";
}

const signal = new AbortController().signal;

describe("selected web tool handlers", () => {
	it("lists vertical extractor capabilities through web_extract", async () => {
		const result = await webExtractTool.execute("call", { action: "list" }, signal);
		expect(result.content[0]?.text).toContain("extractor");
		expect(Array.isArray((result.details as ResultEnvelope).data)).toBe(true);
	});

	it("runs deterministic vertical extraction through web_extract without a model", async () => {
		const result = await webExtractTool.execute(
			"call",
			{
				action: "vertical",
				extractor: "npm",
				url: "https://example.com/package/pi-scraper",
			},
			signal,
		);
		expect(result.content[0]?.text).toContain("npm");
		expect((result.details as ResultEnvelope).format).toBe("json");
	});

	it("pre-renders vertical fetchPage input when mode=browser", async () => {
		const tool = createWebExtractTool({
			scrapeDeps: {
				browserRenderer: {
					fetchRendered: async () => ({
						url: "https://docs.example.com/docs/intro",
						finalUrl: "https://docs.example.com/docs/intro",
						status: 200,
						html: "<main><h1>Rendered Docs</h1><p>Browser-only content.</p></main>",
					}),
				},
			},
		});
		const result = await tool.execute(
			"call",
			{
				action: "vertical",
				extractor: "docsite",
				url: "https://docs.example.com/docs/intro",
				mode: "browser",
			},
			signal,
		);
		const data = ((result.details as ResultEnvelope).data as { data?: { title?: string } }).data;
		expect(data?.title).toBe("Rendered Docs");
		expect(result.content[0]?.text).toContain("browser fallback · cloak");
	});

	it("keeps web_extract adapter vertical-agnostic", () => {
		const source = readFileSync(new URL("../web-extract.ts", import.meta.url), "utf8");

		expect(source).not.toContain('"reddit"');
		expect(source).not.toContain("'reddit'");
	});

	it("returns structured missing-model errors for ad hoc extraction", async () => {
		const result = await webExtractTool.execute("call", { url: "https://example.com" }, signal);
		expect((result.details as ResultEnvelope).error?.code).toBe("MODEL_ADAPTER_MISSING");
		expect(result.content[0]?.text).toContain("model-backed");
	});

	it("runs deterministic pattern inspection without a model", async () => {
		const result = await webExtractTool.execute(
			"call",
			{
				action: "pattern",
				content: "# Tools\nweb_scrape reads pages\nweb_crawl follows links",
				length: true,
				markers: ["# Tools", "missing"],
				contains: ["web_scrape"],
				excerpts: [{ needle: "web_crawl", before: 4, after: 13 }],
				regexes: [
					{
						name: "tool_names",
						pattern: "web_[a-z_]+",
						dedupe: true,
						sort: true,
					},
				],
			},
			signal,
		);
		const envelope = result.details as ResultEnvelope<{
			source: { source: string; length: number };
			markers: Array<{ found: boolean; index: number }>;
			contains: Array<{ found: boolean }>;
			excerpts: Array<{ found: boolean; text?: string }>;
			regexes: Array<{ matches: Array<{ value: string }> }>;
		}>;
		expect(envelope.error).toBeUndefined();
		expect(envelope.data?.source.source).toBe("provided");
		expect(envelope.data?.source.length).toBeGreaterThan(20);
		expect(envelope.data?.markers[0]?.found).toBe(true);
		expect(envelope.data?.markers[1]?.index).toBe(-1);
		expect(envelope.data?.contains[0]?.found).toBe(true);
		expect(envelope.data?.excerpts[0]?.text).toContain("web_crawl");
		expect(envelope.data?.regexes[0]?.matches.map((item) => item.value)).toEqual([
			"web_crawl",
			"web_scrape",
		]);
	});

	it("filters pattern inspection to requested symbols", async () => {
		const result = await webExtractTool.execute(
			"call",
			{
				action: "pattern",
				content:
					"# API\n\n/** Fetch metrics. */\nexport function fetchMetrics(id: string) {}\n\nexport function parseUrl(input: string) {}",
				include: [{ type: "symbol", pattern: "fetchMetrics|parseUrl" }],
			},
			signal,
		);
		const envelope = result.details as ResultEnvelope<{
			selection?: { symbols: Array<{ name: string; description?: string }> };
		}>;

		expect(envelope.error).toBeUndefined();
		expect(envelope.data?.selection?.symbols.map((item) => item.name)).toEqual([
			"fetchMetrics",
			"parseUrl",
		]);
		expect(envelope.data?.selection?.symbols[0]?.description).toContain("Fetch metrics");
	});

	it("returns structured api-reference preset selections", async () => {
		const result = await webExtractTool.execute(
			"call",
			{
				action: "pattern",
				content:
					"# Package\n\n## fetchMetrics\nThe function fetchMetrics helps. We let users decide.\n\n```ts\nexport function fetchMetrics(): Promise<void> {}\n```\n\n| Param | Type |\n| --- | --- |\n| id | string |",
				extractSchema: "api-reference",
			},
			signal,
		);
		const envelope = result.details as ResultEnvelope<{
			selection?: {
				extractSchema?: string;
				sections: unknown[];
				codeBlocks: unknown[];
				tables: unknown[];
				symbols: unknown[];
			};
		}>;

		expect(envelope.error).toBeUndefined();
		expect(envelope.data?.selection?.extractSchema).toBe("api-reference");
		expect(envelope.data?.selection?.sections).toHaveLength(1);
		expect(envelope.data?.selection?.codeBlocks).toHaveLength(1);
		expect(envelope.data?.selection?.tables).toHaveLength(1);
		expect(envelope.data?.selection?.symbols).toHaveLength(0);
	});

	it("returns valid empty selections for unmatched symbol filters", async () => {
		const result = await webExtractTool.execute(
			"call",
			{
				action: "pattern",
				content: "export function fetchMetrics(): void {}",
				include: [{ type: "symbol", pattern: "doesNotExist" }],
			},
			signal,
		);
		const envelope = result.details as ResultEnvelope<{
			selection?: {
				symbols: unknown[];
				unmatched: Array<{ type: string; pattern?: string }>;
			};
		}>;

		expect(envelope.error).toBeUndefined();
		expect(envelope.data?.selection?.symbols).toEqual([]);
		expect(envelope.data?.selection?.unmatched).toEqual([
			{ type: "symbol", pattern: "doesNotExist" },
		]);
	});

	it("scrapes URL text before pattern inspection", async () => {
		const tool = createWebExtractTool({ scrapeDeps: fakeScrapeDeps() });
		const result = await tool.execute(
			"call",
			{
				action: "pattern",
				url: "https://example.com/page",
				sourceFormat: "text",
				contains: ["Fixture Heading"],
			},
			signal,
		);
		const envelope = result.details as ResultEnvelope<{
			source: { source: string; status?: number };
			contains: Array<{ found: boolean }>;
		}>;
		expect(envelope.error).toBeUndefined();
		expect(envelope.data?.source.source).toBe("scrape");
		expect(envelope.data?.source.status).toBe(200);
		expect(envelope.data?.contains[0]?.found).toBe(true);
	});

	it("extracts an API surface from provided documentation without a model", async () => {
		const result = await webExtractTool.execute(
			"call",
			{
				extract: "api-surface",
				content:
					"# Client\n\n## fetchMetrics()\nFetch metrics.\n\n```ts\nfetchMetrics(project: string)\n```",
			},
			signal,
		);
		const envelope = result.details as ResultEnvelope<{
			modules: Array<{ functions: Array<{ name: string }> }>;
		}>;

		expect(envelope.error).toBeUndefined();
		expect(envelope.format).toBe("json");
		expect(envelope.data?.modules[0]?.functions[0]?.name).toBe("fetchMetrics");
	});

	it("returns structured errors for invalid pattern regexes", async () => {
		const result = await webExtractTool.execute(
			"call",
			{ action: "pattern", content: "abc", regexes: [{ pattern: "[" }] },
			signal,
		);
		expect((result.details as ResultEnvelope).error?.code).toBe("PATTERN_INPUT_INVALID");
	});

	it("runs provided-content extraction with an injected model adapter", async () => {
		const requests: unknown[] = [];
		const tool = createWebExtractTool({
			modelAdapter: fakeModelAdapter((request) => {
				requests.push(request);
				return { title: "Local title", kind: request.task };
			}),
		});

		const result = await tool.execute(
			"call",
			{ content: "# Local title\nBody", prompt: "Extract title." },
			signal,
		);
		const envelope = result.details as ResultEnvelope<{
			data: { title: string; kind: string };
			input: { source: string };
		}>;
		expect(envelope.error).toBeUndefined();
		expect(envelope.data?.data).toEqual({
			title: "Local title",
			kind: "extract",
		});
		expect(envelope.data?.input.source).toBe("provided");
		expect(requests).toHaveLength(1);
	});

	it("scrapes URL content before model-backed extraction", async () => {
		const requests: Array<{ input: string }> = [];
		const tool = createWebExtractTool({
			modelAdapter: fakeModelAdapter((request) => {
				requests.push({ input: request.input });
				return { headingFound: request.input.includes("Fixture Heading") };
			}),
			scrapeDeps: fakeScrapeDeps(),
		});

		const result = await tool.execute(
			"call",
			{
				url: "https://example.com/page",
				prompt: "Find heading.",
				mode: "fast",
			},
			signal,
		);
		const envelope = result.details as ResultEnvelope<{
			data: { headingFound: boolean };
			input: { source: string };
		}>;
		expect(envelope.error).toBeUndefined();
		expect(envelope.data?.data.headingFound).toBe(true);
		expect(envelope.data?.input.source).toBe("scrape");
		expect(requests[0]?.input).toContain("Fixture Heading");
	});

	it("registers model-backed extract and scrape-summary paths", async () => {
		const registered: WebTool[] = [];
		const registrar = {
			registerTool(tool: WebTool) {
				registered.push(tool);
			},
		};
		await registerWebTools(registrar as unknown as PiToolRegistrar);
		void registered.find((tool) => tool.name === "web_scrape");
		void registered.find((tool) => tool.name === "web_extract");
		void registered.find((tool) => tool.name === "web_summarize");

		// Adapters are resolved at execute time from context, not baked in at registration
		const adapter = fakeModelAdapter(summarizeOrExtractAdapter);
		const extracted = await createWebExtractTool({ modelAdapter: adapter }).execute(
			"call",
			{ content: "content", prompt: "extract" },
			signal,
		);
		expect((extracted.details as ResultEnvelope<{ data: { ok: boolean } }>)?.data?.data?.ok).toBe(
			true,
		);

		const summarized = await createWebScrapeTool({ modelAdapter: adapter }).execute(
			"call",
			{ task: "summarize", content: "content", sentences: 1 },
			signal,
		);
		expect(summarized.content[0]?.text).toBe("registered summary");

		const summarizedDirectly = await createWebExtractTool({ modelAdapter: adapter }).execute(
			"call",
			{ action: "summarize", content: "content", sentences: 1 },
			signal,
		);
		expect(summarizedDirectly.content[0]?.text).toBe("registered summary");
	});

	it("runs provided-content and URL-backed summarization with an injected model adapter", async () => {
		const tool = createWebScrapeTool({
			modelAdapter: fakeModelAdapter(fixtureHeadingAdapter),
			scrapeDeps: fakeScrapeDeps(),
		});

		const provided = await tool.execute(
			"call",
			{ task: "summarize", content: "Provided content", sentences: 1 },
			signal,
		);
		expect(provided.content[0]?.text).toBe("Summary from provided content.");

		const scraped = await tool.execute(
			"call",
			{
				task: "summarize",
				url: "https://example.com/page",
				bullets: 2,
				mode: "fast",
			},
			signal,
		);
		const envelope = scraped.details as ResultEnvelope<{
			summary: string;
			input: { source: string };
		}>;
		expect(envelope.error).toBeUndefined();
		expect(envelope.data?.summary).toBe("Summary from scraped page.");
		expect(envelope.data?.input.source).toBe("scrape");
	});

	it("runs dedicated provided-content and URL-backed summarization", async () => {
		const tool = createWebExtractTool({
			modelAdapter: fakeModelAdapter(fixtureHeadingAdapter),
			scrapeDeps: fakeScrapeDeps(),
		});

		const provided = await tool.execute(
			"call",
			{ action: "summarize", content: "Provided content", sentences: 1 },
			signal,
		);
		expect(provided.content[0]?.text).toBe("Summary from provided content.");

		const scraped = await tool.execute(
			"call",
			{
				action: "summarize",
				url: "https://example.com/page",
				bullets: 2,
				mode: "fast",
			},
			signal,
		);
		const envelope = scraped.details as ResultEnvelope<{
			summary: string;
			input: { source: string };
		}>;
		expect(envelope.error).toBeUndefined();
		expect(envelope.data?.summary).toBe("Summary from scraped page.");
		expect(envelope.data?.input.source).toBe("scrape");
	});

	it("renders compact calls and expanded results", async () => {
		const result = await webExtractTool.execute("call", { action: "list" }, signal);
		expect(renderComponentText(webExtractTool.renderCall?.({ action: "list" }, undefined))).toBe(
			"web_extract list",
		);
		expect(
			renderComponentText(webExtractTool.renderResult?.(result, { expanded: true }, undefined)),
		).toContain("extractor");
	});

	it("renders get-result collapsed status for found and missing results", async () => {
		const missingResult = await webGetResultTool.execute("call", { jobId: "missing-job" }, signal);
		expect(missingResult.isError).toBe(true);

		const theme: RenderTheme = {
			fg: (name, text) => `<fg:${name}>${text}</fg:${name}>`,
			bg: (name, text) => `<bg:${name}>${text}</bg:${name}>`,
		};
		const found = renderComponentText(
			webGetResultTool.renderResult?.(
				{
					content: [{ type: "text", text: "Stored result abc: 1 field" }],
					details: { data: { ok: true }, truncated: false },
				},
				{ expanded: false },
				theme,
			),
		);
		const missing = renderComponentText(
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
		const lines = renderText("x".repeat(150)).render(40);
		expect(lines.length).toBeGreaterThan(1);
		expect(lines.every((line) => line.length <= 40)).toBe(true);
	});

	it("extracts JSONPath-selected values for pattern inspection", async () => {
		const notebook = {
			cells: [
				{ cell_type: "code", source: ["import os\n", "print(1)"] },
				{ cell_type: "markdown", source: ["# Intro\n", "Welcome."] },
			],
		};
		const result = await webExtractTool.execute(
			"call",
			{
				action: "pattern",
				content: JSON.stringify(notebook),
				sourceFormat: "json",
				jsonPaths: ["$.cells[*].source"],
				contains: ["import os"],
				excerpts: [{ needle: "Welcome", after: 10 }],
			},
			signal,
		);
		const envelope = result.details as ResultEnvelope<{
			source: {
				sourceFormat: string;
				json?: {
					paths: Array<{ path: string; matched: number; missing: boolean }>;
					selectedLength: number;
				};
			};
			contains: Array<{ found: boolean }>;
			excerpts: Array<{ found: boolean; text?: string }>;
		}>;
		expect(envelope.error).toBeUndefined();
		expect(envelope.data?.source.sourceFormat).toBe("json");
		expect(envelope.data?.source.json?.paths).toEqual([
			{ path: "$.cells[*].source", matched: 2, missing: false },
		]);
		expect(envelope.data?.source.json?.selectedLength).toBeGreaterThan(0);
		expect(envelope.data?.contains[0]?.found).toBe(true);
		expect(envelope.data?.excerpts[0]?.found).toBe(true);
	});

	it("reports structured errors for invalid JSON in pattern mode", async () => {
		const result = await webExtractTool.execute(
			"call",
			{
				action: "pattern",
				content: "not json",
				sourceFormat: "json",
				jsonPaths: ["$.a"],
			},
			signal,
		);
		expect((result.details as ResultEnvelope).error?.code).toBe("JSON_PARSE_FAILED");
	});

	it("reports structured errors for unsupported JSONPath syntax", async () => {
		const result = await webExtractTool.execute(
			"call",
			{
				action: "pattern",
				content: JSON.stringify({ a: 1 }),
				sourceFormat: "json",
				jsonPaths: ["$..a"],
			},
			signal,
		);
		expect((result.details as ResultEnvelope).error?.code).toBe("JSON_PATH_UNSUPPORTED");
	});

	it("reports no-match error when all JSONPaths miss", async () => {
		const result = await webExtractTool.execute(
			"call",
			{
				action: "pattern",
				content: JSON.stringify({ a: 1 }),
				sourceFormat: "json",
				jsonPaths: ["$.missing"],
			},
			signal,
		);
		expect((result.details as ResultEnvelope).error?.code).toBe("JSON_PATH_NO_MATCH");
	});

	it("runs JSON pattern inspection from scraped URL", async () => {
		const tool = createWebExtractTool({
			scrapeDeps: {
				httpClient: {
					async fetchUrl() {
						const json = JSON.stringify({ items: [{ name: "alpha" }] });
						return {
							url: "https://example.com/api",
							finalUrl: "https://example.com/api",
							status: 200,
							headers: { "content-type": "application/json" },
							contentType: "application/json",
							text: json,
							downloadedBytes: Buffer.byteLength(json),
						};
					},
				},
			},
		});
		const result = await tool.execute(
			"call",
			{
				action: "pattern",
				url: "https://example.com/api",
				sourceFormat: "json",
				jsonPaths: ["$.items[*].name"],
				contains: ["alpha"],
			},
			signal,
		);
		const envelope = result.details as ResultEnvelope<{
			source: { source: string; sourceFormat: string };
			contains: Array<{ found: boolean }>;
		}>;
		expect(envelope.error).toBeUndefined();
		expect(envelope.data?.source.source).toBe("scrape");
		expect(envelope.data?.source.sourceFormat).toBe("json");
		expect(envelope.data?.contains[0]?.found).toBe(true);
	});
});

function renderComponentText(component: RenderComponent | undefined): string {
	return component?.render(80).join("\n") ?? "";
}

function fakeModelAdapter(respond: (request: ModelRequest) => unknown): ModelAdapter {
	return {
		async run<T = unknown>(request: ModelRequest): Promise<ModelResponse<T>> {
			const data = respond(request);
			return {
				data: data as T,
				text: typeof data === "string" ? data : JSON.stringify(data),
			};
		},
	};
}

function fakeScrapeDeps(): ScrapePipelineDeps {
	return {
		httpClient: {
			async fetchUrl() {
				const html = `<!doctype html><html><head><title>Fixture</title></head><body><main><h1>Fixture Heading</h1><p>Fixture body text.</p></main></body></html>`;
				return {
					url: "https://example.com/page",
					finalUrl: "https://example.com/page",
					status: 200,
					headers: { "content-type": "text/html; charset=utf-8" },
					contentType: "text/html; charset=utf-8",
					text: html,
					downloadedBytes: Buffer.byteLength(html),
				};
			},
		},
	};
}
