/**
 * @file All web_extract tool tests — one describe block per action. Actions: dispatcher, vertical,
 *   pattern, surface, adhoc, summarize, selector, plus model-adapter provider routing (summarize +
 *   adhoc). Shared helpers (signal, fakeScrapeDeps, fakeModelAdapter) live in ./fixtures.ts.
 */
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type {
	ModelAdapter,
	ModelRequest,
	ModelResponse,
	ModelUsage,
} from "../../extract/adhoc/model.ts";
import type { ToolContext } from "../../types.ts";
import type { PiToolRegistrar, WebTool } from "../infra/define.ts";
import {
	modelRegistry,
	initModelAdapterProtocol,
	type RegisteredAdapter,
} from "../infra/model-registry.ts";
import { registerWebTools } from "../infra/register.ts";
import { runSelectorExtractionTool } from "../web-extract-selector.ts";
import { createWebExtractTool, webExtractTool } from "../web-extract.ts";
import { fakeModelAdapter, fakeScrapeDeps, signal } from "./fixtures.ts";

type HostModel = ExtensionContext["model"];

// ---------------------------------------------------------------------------
// dispatcher
// ---------------------------------------------------------------------------

function summarizeOrExtractAdapter(request: ModelRequest): string | { ok: boolean } {
	return request.task === "summarize" ? "registered summary" : { ok: true };
}

describe("web_extract — dispatcher", () => {
	it("keeps the web_extract adapter vertical-agnostic", () => {
		const source = readFileSync(new URL("../web-extract.ts", import.meta.url), "utf8");

		expect(source).not.toContain('"reddit"');
		expect(source).not.toContain("'reddit'");
	});

	it("returns structured missing-model errors for ad hoc extraction", async () => {
		const result = await webExtractTool.execute("call", { url: "https://example.com" }, signal);
		expect((result.details as ToolContext).error?.code).toBe("MODEL_ADAPTER_MISSING");
		expect(result.content[0]?.text).toContain("model-backed");
	});

	it("registers model-backed extract and summarize paths", async () => {
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

		// Adapters are resolved at execute time from context, not baked in at registration.
		const adapter = fakeModelAdapter(summarizeOrExtractAdapter);
		const extracted = await createWebExtractTool({ modelAdapter: adapter }).execute(
			"call",
			{ content: "content", prompt: "extract" },
			signal,
		);
		expect((extracted.details as ToolContext<{ data: { ok: boolean } }>)?.data?.data?.ok).toBe(
			true,
		);

		const summarizedDirectly = await createWebExtractTool({ modelAdapter: adapter }).execute(
			"call",
			{ action: "summarize", content: "content", sentences: 1 },
			signal,
		);
		expect(summarizedDirectly.content[0]?.text).toBe("registered summary");
	});
});

// ---------------------------------------------------------------------------
// action=vertical
// ---------------------------------------------------------------------------

describe("web_extract — action=vertical", () => {
	it("lists vertical extractor capabilities through web_extract", async () => {
		const result = await webExtractTool.execute("call", { action: "list" }, signal);
		expect(result.content[0]?.text).toContain("extractor");
		expect(Array.isArray((result.details as ToolContext).data)).toBe(true);
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
		expect((result.details as ToolContext).format).toBe("json");
	});

	it("pre-renders vertical fetchPage input when mode=browser", async () => {
		const tool = createWebExtractTool({
			openBrowserFetchSession: async () => ({
				rendered: {
					url: "https://docs.example.com/docs/intro",
					finalUrl: "https://docs.example.com/docs/intro",
					status: 200,
					html: "<main><h1>Rendered Docs</h1><p>Browser-only content.</p></main>",
				},
				pageFetch: async () => ({
					status: 200,
					text: "",
					finalUrl: "https://docs.example.com/docs/intro",
					contentType: "text/html",
				}),
				close: async () => {
					/* no-op */
				},
			}),
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
		const data = ((result.details as ToolContext).data as { data?: { title?: string } }).data;
		expect(data?.title).toBe("Rendered Docs");
		expect(result.content[0]?.text).toContain("browser fallback · cloak");
	});

	it("defaults requiresBrowser verticals to browser+cloak when mode unset", async () => {
		let opened: { sessionId?: string; browserBackend?: string } | undefined;
		const tool = createWebExtractTool({
			openBrowserFetchSession: async (input) => {
				opened = input;
				return {
					rendered: { url: input.url, finalUrl: input.url, status: 200, html: "" },
					pageFetch: async () => ({
						status: 200,
						text: "[]",
						finalUrl: input.url,
						contentType: "application/json",
					}),
					close: async () => {
						/* no-op */
					},
				};
			},
		});
		await tool.execute(
			"call",
			{
				action: "vertical",
				extractor: "reddit",
				url: "https://www.reddit.com/r/typescript/comments/1abcde/x/",
			},
			signal,
		);
		expect(opened?.browserBackend).toBe("cloak");
		expect(opened?.sessionId).toMatch(/^vertical-/u);
	});

	it("rejects an extractor/url mismatch with a suggestion before opening a browser", async () => {
		let opened = false;
		const tool = createWebExtractTool({
			openBrowserFetchSession: async (input) => {
				opened = true;
				return {
					rendered: { url: input.url, finalUrl: input.url, status: 200, html: "" },
					pageFetch: async () => ({
						status: 200,
						text: "[]",
						finalUrl: input.url,
						contentType: "application/json",
					}),
					close: async () => {
						/* no-op */
					},
				};
			},
		});
		const result = await tool.execute(
			"call",
			{
				action: "vertical",
				extractor: "reddit",
				url: "https://www.reddit.com/r/typescript",
			},
			signal,
		);
		const error = (result.details as ToolContext).error;
		expect(error?.code).toBe("EXTRACTOR_URL_MISMATCH");
		expect(error?.message).toContain("reddit_listing");
		expect(opened).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// action=pattern
// ---------------------------------------------------------------------------

describe("web_extract — action=pattern", () => {
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
		const envelope = result.details as ToolContext<{
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
		const envelope = result.details as ToolContext<{
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
		const envelope = result.details as ToolContext<{
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
		const envelope = result.details as ToolContext<{
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
		const envelope = result.details as ToolContext<{
			source: { source: string; status?: number };
			contains: Array<{ found: boolean }>;
		}>;
		expect(envelope.error).toBeUndefined();
		expect(envelope.data?.source.source).toBe("scrape");
		expect(envelope.data?.source.status).toBe(200);
		expect(envelope.data?.contains[0]?.found).toBe(true);
	});

	it("returns structured errors for invalid pattern regexes", async () => {
		const result = await webExtractTool.execute(
			"call",
			{ action: "pattern", content: "abc", regexes: [{ pattern: "[" }] },
			signal,
		);
		expect((result.details as ToolContext).error?.code).toBe("PATTERN_INPUT_INVALID");
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
		const envelope = result.details as ToolContext<{
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
		expect((result.details as ToolContext).error?.code).toBe("JSON_PARSE_FAILED");
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
		expect((result.details as ToolContext).error?.code).toBe("JSON_PATH_UNSUPPORTED");
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
		expect((result.details as ToolContext).error?.code).toBe("JSON_PATH_NO_MATCH");
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
		const envelope = result.details as ToolContext<{
			source: { source: string; sourceFormat: string };
			contains: Array<{ found: boolean }>;
		}>;
		expect(envelope.error).toBeUndefined();
		expect(envelope.data?.source.source).toBe("scrape");
		expect(envelope.data?.source.sourceFormat).toBe("json");
		expect(envelope.data?.contains[0]?.found).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// action=surface (deterministic API surface)
// ---------------------------------------------------------------------------

describe("web_extract — action=surface", () => {
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
		const envelope = result.details as ToolContext<{
			modules: Array<{ functions: Array<{ name: string }> }>;
		}>;

		expect(envelope.error).toBeUndefined();
		expect(envelope.format).toBe("json");
		expect(envelope.data?.modules[0]?.functions[0]?.name).toBe("fetchMetrics");
	});
});

// ---------------------------------------------------------------------------
// action=adhoc (model-backed extraction)
// ---------------------------------------------------------------------------

function mockHostExtractAdapter(usage?: ModelUsage): unknown {
	return {
		async run<T>(_req: ModelRequest, _signal?: AbortSignal): Promise<ModelResponse<T>> {
			return { data: { extracted: "host-model data" } as T, usage };
		},
	};
}

describe("web_extract — action=adhoc host model via ctx", () => {
	it("uses ctx.model when no explicit adapter is provided", async () => {
		const tool = createWebExtractTool({ scrapeDeps: fakeScrapeDeps() });
		const result = await tool.execute(
			"call",
			{ url: "https://example.com/page", prompt: "Extract heading." },
			signal,
			undefined,
			{ model: mockHostExtractAdapter() as HostModel },
		);
		expect(
			(result.details as { data?: { data?: { extracted: string } } }).data?.data?.extracted,
		).toBe("host-model data");
	});

	it("forwards usage from host model to envelope", async () => {
		const usage: ModelUsage = {
			provider: "pi-host",
			model: "gpt-4",
			inputTokens: 200,
			outputTokens: 75,
		};
		const tool = createWebExtractTool({ scrapeDeps: fakeScrapeDeps() });
		const result = await tool.execute(
			"call",
			{ url: "https://example.com/page", prompt: "Extract heading." },
			signal,
			undefined,
			{ model: mockHostExtractAdapter(usage) as HostModel },
		);
		expect((result.details as { modelUsage?: ModelUsage }).modelUsage).toEqual(usage);
	});

	it("does not emit event-bus discover when host model is available", async () => {
		const tool = createWebExtractTool({ scrapeDeps: fakeScrapeDeps() });
		const result = await tool.execute(
			"call",
			{ url: "https://example.com/page", prompt: "Extract heading." },
			signal,
			undefined,
			{ model: mockHostExtractAdapter() as HostModel },
		);
		expect((result.details as { error?: { code: string } }).error).toBeUndefined();
		expect(
			(result.details as { data?: { data?: { extracted: string } } }).data?.data?.extracted,
		).toBe("host-model data");
	});
});

describe("web_extract — action=adhoc via injected adapter", () => {
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
		const envelope = result.details as ToolContext<{
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
		const envelope = result.details as ToolContext<{
			data: { headingFound: boolean };
			input: { source: string };
		}>;
		expect(envelope.error).toBeUndefined();
		expect(envelope.data?.data.headingFound).toBe(true);
		expect(envelope.data?.input.source).toBe("scrape");
		expect(requests[0]?.input).toContain("Fixture Heading");
	});
});

// ---------------------------------------------------------------------------
// action=summarize
// ---------------------------------------------------------------------------

function fixtureHeadingAdapter(request: ModelRequest): string {
	return request.input.includes("Fixture Heading")
		? "Summary from scraped page."
		: "Summary from provided content.";
}

function mockHostSummaryAdapter(usage?: ModelUsage): unknown {
	return {
		async run<T>(_req: ModelRequest, _signal?: AbortSignal): Promise<ModelResponse<T>> {
			return { data: "host-model summary" as T, usage };
		},
	};
}

function makeAdapter(label: string): {
	adapter: { run<T>(_req: ModelRequest, _signal?: AbortSignal): Promise<ModelResponse<T>> };
	calls: string[];
} {
	const calls: string[] = [];
	return {
		adapter: {
			run<T>(_req: ModelRequest, _signal?: AbortSignal): Promise<ModelResponse<T>> {
				calls.push(label);
				return Promise.resolve({ data: `from-${label}` as T });
			},
		},
		calls,
	};
}

function mockAdapter(usage?: ModelUsage): ModelAdapter {
	return {
		async run<T>(_req: ModelRequest, _signal?: AbortSignal): Promise<ModelResponse<T>> {
			return { data: "summary text" as T, usage };
		},
	};
}

describe("web_extract — action=summarize host model via ctx", () => {
	it("uses ctx.model when no explicit adapter is provided", async () => {
		const tool = createWebExtractTool({ scrapeDeps: fakeScrapeDeps() });
		const result = await tool.execute(
			"call",
			{ action: "summarize", url: "https://example.com/page", sentences: 2 },
			signal,
			undefined,
			{ model: mockHostSummaryAdapter() as HostModel },
		);
		expect(result.content[0]?.text).toContain("host-model summary");
	});

	it("forwards usage from host model to envelope", async () => {
		const usage: ModelUsage = {
			provider: "pi-host",
			model: "gpt-4",
			inputTokens: 100,
			outputTokens: 50,
			totalTokens: 150,
		};
		const tool = createWebExtractTool({ scrapeDeps: fakeScrapeDeps() });
		const result = await tool.execute(
			"call",
			{ action: "summarize", url: "https://example.com/page", sentences: 2 },
			signal,
			undefined,
			{ model: mockHostSummaryAdapter(usage) as HostModel },
		);
		expect((result.details as { modelUsage?: ModelUsage }).modelUsage).toEqual(usage);
	});

	it("does not emit MODEL_ADAPTER_MISSING when host model is available", async () => {
		const tool = createWebExtractTool({ scrapeDeps: fakeScrapeDeps() });
		const result = await tool.execute(
			"call",
			{ action: "summarize", url: "https://example.com/page", sentences: 2 },
			signal,
			undefined,
			{ model: mockHostSummaryAdapter() as HostModel },
		);
		expect((result.details as { error?: { code: string } }).error).toBeUndefined();
		expect(result.content[0]?.text).toContain("host-model summary");
	});
});

describe("web_extract — action=summarize adapter resolution precedence", () => {
	it("options.modelAdapter beats ctx.model", async () => {
		const injected = makeAdapter("injected");
		const host = makeAdapter("host");
		const tool = createWebExtractTool({
			modelAdapter: injected.adapter as unknown as ModelAdapter,
			scrapeDeps: fakeScrapeDeps(),
		});
		const result = await tool.execute(
			"call",
			{ action: "summarize", url: "https://example.com/page", sentences: 2 },
			signal,
			undefined,
			{ model: host.adapter as unknown as HostModel },
		);
		expect(result.content[0]?.text).toContain("from-injected");
		expect(injected.calls.length).toBe(1);
		expect(host.calls.length).toBe(0);
	});

	it("ctx.model beats event-bus registry", async () => {
		modelRegistry.clear();
		const registered = makeAdapter("registry");
		modelRegistry.register({
			id: "test-registry",
			label: "test",
			capabilities: ["summarize"],
			priority: 100,
			adapter: registered.adapter as unknown as ModelAdapter,
		});
		const host = makeAdapter("host");
		const tool = createWebExtractTool({ scrapeDeps: fakeScrapeDeps() });
		const result = await tool.execute(
			"call",
			{ action: "summarize", url: "https://example.com/page", sentences: 2 },
			signal,
			undefined,
			{ model: host.adapter as unknown as HostModel },
		);
		expect(result.content[0]?.text).toContain("from-host");
		expect(registered.calls.length).toBe(0);
		expect(host.calls.length).toBe(1);
	});

	it("event-bus registry beats MODEL_ADAPTER_MISSING", async () => {
		modelRegistry.clear();
		const registered = makeAdapter("registry");
		modelRegistry.register({
			id: "test-registry",
			label: "test",
			capabilities: ["summarize"],
			priority: 100,
			adapter: registered.adapter as unknown as ModelAdapter,
		});
		const tool = createWebExtractTool({ scrapeDeps: fakeScrapeDeps() });
		const result = await tool.execute(
			"call",
			{ action: "summarize", url: "https://example.com/page", sentences: 2 },
			signal,
		);
		expect(result.content[0]?.text).toContain("from-registry");
		expect(registered.calls.length).toBe(1);
	});
});

describe("web_extract — action=summarize ModelUsage forwarding", () => {
	it("forwards full usage to envelope when adapter returns it", async () => {
		const usage: ModelUsage = {
			provider: "gemini-acp",
			model: "gemini-2.0-flash",
			inputTokens: 234,
			outputTokens: 187,
			totalTokens: 421,
			costUSD: 0.0023,
		};
		const tool = createWebExtractTool({
			modelAdapter: mockAdapter(usage),
			scrapeDeps: fakeScrapeDeps(),
		});
		const result = await tool.execute(
			"call",
			{ action: "summarize", url: "https://example.com/page", sentences: 3 },
			signal,
		);
		expect((result.details as { modelUsage?: ModelUsage }).modelUsage).toEqual(usage);
	});

	it("forwards partial usage (tokens but no cost)", async () => {
		const usage: ModelUsage = {
			provider: "ollama",
			inputTokens: 100,
			outputTokens: 50,
		};
		const tool = createWebExtractTool({
			modelAdapter: mockAdapter(usage),
			scrapeDeps: fakeScrapeDeps(),
		});
		const result = await tool.execute(
			"call",
			{ action: "summarize", url: "https://example.com/page", sentences: 3 },
			signal,
		);
		const modelUsage = (result.details as { modelUsage?: ModelUsage }).modelUsage;
		expect(modelUsage?.provider).toBe("ollama");
		expect(modelUsage?.inputTokens).toBe(100);
		expect(modelUsage?.outputTokens).toBe(50);
		expect(modelUsage?.costUSD).toBeUndefined();
	});

	it("leaves modelUsage undefined when adapter returns no usage", async () => {
		const tool = createWebExtractTool({
			modelAdapter: mockAdapter(undefined),
			scrapeDeps: fakeScrapeDeps(),
		});
		const result = await tool.execute(
			"call",
			{ action: "summarize", url: "https://example.com/page", sentences: 3 },
			signal,
		);
		expect((result.details as { modelUsage?: ModelUsage }).modelUsage).toBeUndefined();
	});

	it("passes through garbage usage without validation", async () => {
		const usage = {
			provider: "bad-adapter",
			inputTokens: "234" as unknown as number,
		} as ModelUsage;
		const tool = createWebExtractTool({
			modelAdapter: mockAdapter(usage),
			scrapeDeps: fakeScrapeDeps(),
		});
		const result = await tool.execute(
			"call",
			{ action: "summarize", url: "https://example.com/page", sentences: 3 },
			signal,
		);
		const modelUsage = (result.details as { modelUsage?: ModelUsage }).modelUsage;
		expect(modelUsage?.provider).toBe("bad-adapter");
		expect(modelUsage?.inputTokens).toBe("234");
	});
});

/** Build a mock Pi whose events honour DiscoverPayload filters. */
type DiscoverHandlers = Map<string, Array<(payload: unknown) => void>>;

function mockPiWithFilteredDiscover() {
	const events: Array<{ event: string; payload: unknown }> = [];
	const handlers: DiscoverHandlers = new Map();
	const pi = {
		events: {
			on(event: string, handler: (payload: unknown) => void) {
				if (!handlers.has(event)) handlers.set(event, []);
				handlers.get(event)!.push(handler);
			},
			emit(event: string, payload: unknown) {
				events.push({ event, payload });
				for (const h of handlers.get(event) ?? []) h(payload);
			},
		},
	};
	return { pi, events, handlers };
}

function fakeRegisteredAdapter(id: string, capabilities: readonly string[]): RegisteredAdapter {
	return {
		id,
		label: id,
		capabilities: capabilities as RegisteredAdapter["capabilities"],
		priority: 50,
		adapter: {
			async run<T>(): Promise<ModelResponse<T>> {
				return { data: `from-${id}` as T };
			},
		},
	};
}

function registerFilteredProvider(
	handlers: DiscoverHandlers,
	providerEntry: RegisteredAdapter,
): void {
	handlers.set("pi:model-adapter/discover", [
		(payload: unknown) => {
			const filter = payload as {
				capabilities?: readonly string[];
			};
			if (matchesDiscoverFilter(providerEntry, filter.capabilities)) {
				modelRegistry.register(providerEntry);
			}
		},
	]);
}

function matchesDiscoverFilter(
	providerEntry: RegisteredAdapter,
	capabilities: readonly string[] | undefined,
): boolean {
	return (
		capabilities === undefined ||
		providerEntry.capabilities.some((capability) => capabilities.includes(capability))
	);
}

describe("web_extract — action=summarize lazy filtered discover", () => {
	beforeEach(() => {
		modelRegistry.clear();
	});

	it("triggers filtered discover on first invocation when no adapter is registered", async () => {
		const { pi, events } = mockPiWithFilteredDiscover();
		initModelAdapterProtocol(pi);

		const tool = createWebExtractTool();
		const result = await tool.execute(
			"call",
			{ action: "summarize", content: "page text", sentences: 1 },
			signal,
			undefined,
			{
				getFlag: () => {
					/* no-op */
				},
			},
		);

		const discovers = events.filter((e) => e.event === "pi:model-adapter/discover");
		expect(discovers.length).toBeGreaterThanOrEqual(1);
		const lazy = discovers.at(-1);
		expect(lazy?.payload).toEqual({ capabilities: ["summarize"] });
		expect((result.details as { error?: { code: string } }).error?.code).toBe(
			"MODEL_ADAPTER_MISSING",
		);
	});

	it("lazy discover causes a matching provider to re-register and route", async () => {
		const { pi, events, handlers } = mockPiWithFilteredDiscover();

		const providerEntry = fakeRegisteredAdapter("gemini", ["summarize"]);
		registerFilteredProvider(handlers, providerEntry);

		initModelAdapterProtocol(pi);

		const tool = createWebExtractTool();
		const result = await tool.execute(
			"call",
			{ action: "summarize", content: "page text", sentences: 1 },
			signal,
			undefined,
			{
				getFlag: () => {
					/* no-op */
				},
			},
		);

		expect(result.content[0]?.text).toContain("from-gemini");
		const discovers = events.filter((e) => e.event === "pi:model-adapter/discover");
		expect(discovers.length).toBeGreaterThanOrEqual(1);
	});

	it("provider with non-matching capability does not re-register under filtered discover", async () => {
		const { pi, handlers } = mockPiWithFilteredDiscover();

		const providerEntry = fakeRegisteredAdapter("extractor-only", ["extract"]);
		registerFilteredProvider(handlers, providerEntry);

		initModelAdapterProtocol(pi);
		modelRegistry.clear();

		const tool = createWebExtractTool();
		const result = await tool.execute(
			"call",
			{ action: "summarize", content: "page text", sentences: 1 },
			signal,
			undefined,
			{
				getFlag: () => {
					/* no-op */
				},
			},
		);

		expect((result.details as { error?: { code: string } }).error?.code).toBe(
			"MODEL_ADAPTER_MISSING",
		);
		expect(modelRegistry.list().map((e) => e.id)).toEqual([]);
	});

	it("second invocation does not re-emit discover (cache works)", async () => {
		const { pi, events, handlers } = mockPiWithFilteredDiscover();

		const providerEntry = fakeRegisteredAdapter("gemini", ["summarize"]);
		registerFilteredProvider(handlers, providerEntry);

		initModelAdapterProtocol(pi);

		const tool = createWebExtractTool();
		await tool.execute(
			"call",
			{ action: "summarize", content: "page text", sentences: 1 },
			signal,
			undefined,
			{
				getFlag: () => {
					/* no-op */
				},
			},
		);
		const discoversAfterFirst = events.filter(
			(e) => e.event === "pi:model-adapter/discover",
		).length;

		await tool.execute(
			"call",
			{ action: "summarize", content: "page text", sentences: 1 },
			signal,
			undefined,
			{
				getFlag: () => {
					/* no-op */
				},
			},
		);
		const discoversAfterSecond = events.filter(
			(e) => e.event === "pi:model-adapter/discover",
		).length;

		expect(discoversAfterSecond).toBe(discoversAfterFirst);
	});
});

describe("web_extract — action=summarize via injected adapter", () => {
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
		const envelope = scraped.details as ToolContext<{
			summary: string;
			input: { source: string };
		}>;
		expect(envelope.error).toBeUndefined();
		expect(envelope.data?.summary).toBe("Summary from scraped page.");
		expect(envelope.data?.input.source).toBe("scrape");
	});
});

// ---------------------------------------------------------------------------
// action=selector
// ---------------------------------------------------------------------------

describe("web_extract — action=selector", () => {
	let homeDir: string;
	let originalHome: string | undefined;

	beforeEach(async () => {
		homeDir = await mkdtemp(path.join(tmpdir(), "pi-scraper-selector-"));
		originalHome = process.env.HOME;
		process.env.HOME = homeDir;
	});

	afterEach(async () => {
		if (originalHome === undefined) delete process.env.HOME;
		else process.env.HOME = originalHome;
		await rm(homeDir, { recursive: true, force: true });
	});

	it("extracts matching CSS selectors from content", async () => {
		const result = await runSelectorExtractionTool(
			{
				action: "selector",
				selector: ".product-card",
				selectorType: "css",
				content:
					"<html><body><div class='product-card'><h2>Product 1</h2></div></div></body></html>",
				identifier: "test-products",
				autoSave: false,
				adaptive: false,
				threshold: 0.35,
			},
			{},
			new AbortController().signal,
		);

		expect(result.content[0]?.text).toContain("Product 1");
		expect(result.details?.data?.strategy).toBe("direct");
		expect(result.details?.data?.directMatches).toBe(1);
	});

	it("saves fingerprint with autoSave", async () => {
		const content = "<html><body><div class='card'><h2>Product 1</h2></div></body></html>";

		// First call with autoSave
		const first = await runSelectorExtractionTool(
			{
				action: "selector",
				selector: ".card",
				selectorType: "css",
				content,
				identifier: "autosave-test",
				autoSave: true,
				adaptive: false,
				threshold: 0.35,
			},
			{},
			new AbortController().signal,
		);

		expect(first.details?.data?.saved).toBe(true);

		// Second call with adaptive + changed content
		const second = await runSelectorExtractionTool(
			{
				action: "selector",
				selector: ".card",
				selectorType: "css",
				content:
					"<html><body><div class='wrapper'><div class='new-card'><h2>Product 1</h2></div></div></body></html>",
				identifier: "autosave-test",
				autoSave: false,
				adaptive: true,
				threshold: 0.3,
			},
			{},
			new AbortController().signal,
		);

		expect(second.details?.data?.strategy).toBe("adaptive");
		expect(second.details?.data?.score).toBeGreaterThan(0.3);
		expect(second.content[0]?.text).toContain("Product 1");
	});

	it("returns structured none when selector doesn't match", async () => {
		const result = await runSelectorExtractionTool(
			{
				action: "selector",
				selector: ".does-not-exist",
				selectorType: "css",
				content: ".product-card>h2>Product 1</h2></div>",
				identifier: "no-match-test",
				adaptive: false,
				autoSave: false,
				threshold: 0.35,
			},
			{},
			new AbortController().signal,
		);

		expect(result.details?.data?.strategy).toBe("none");
		expect(result.details?.data?.directMatches).toBe(0);
		expect(result.details?.data?.adaptiveMatches).toBe(0);
	});

	it("errors when selector is missing", async () => {
		const result = await runSelectorExtractionTool(
			{
				action: "selector",
				identifier: "missing-test",
			},
			{},
			new AbortController().signal,
		);

		expect(result.details?.error?.code).toBe("SELECTOR_INPUT_MISSING");
	});

	it("handles text selector", async () => {
		const result = await runSelectorExtractionTool(
			{
				action: "selector",
				selector: "Product 1",
				selectorType: "text",
				content: "<html><body><div><h2>Product 1</h2></div></body></html>",
				identifier: "text-test",
				autoSave: false,
				adaptive: false,
				threshold: 0.35,
			},
			{},
			new AbortController().signal,
		);

		expect(result.details?.data?.strategy).toBe("direct");
		expect(result.content[0]?.text).toContain("Product 1");
	});
});

// ---------------------------------------------------------------------------
// action=vertical — live Stack Overflow summary smoke (network, opt-in)
// ---------------------------------------------------------------------------

describe.skipIf(process.env.PI_SCRAPER_LIVE !== "1")("live stackoverflow summary", () => {
	it("includes answer count in collapsed vertical summary", async () => {
		const result = await webExtractTool.execute(
			"call",
			{
				action: "vertical",
				extractor: "stackoverflow",
				url: "https://stackoverflow.com/questions/11227809/why-is-conditional-processing-of-a-sorted-array-faster-than-of-an-unsorted-array",
			},
			AbortSignal.timeout(60_000),
		);
		const text = result.content[0]?.text ?? "";
		expect(text).toContain("answers");
		expect(text).not.toMatch(/\bvideo\b/iu);
	}, 90_000);
});

// ---------------------------------------------------------------------------
// Provider routing — model-adapter protocol resolution via the registry
// (summarize + adhoc): provider=auto/explicit/off, capability + not-found errors.
// ---------------------------------------------------------------------------

function fakeAdapter(
	id: string,
	capabilities: Array<"summarize" | "extract">,
	priority = 50,
): ModelAdapter & { id: string; calls: ModelRequest[] } {
	const calls: ModelRequest[] = [];
	const adapter: ModelAdapter & { id: string; calls: ModelRequest[] } = {
		id,
		calls,
		async run<T>(req: ModelRequest, _signal?: AbortSignal): Promise<ModelResponse<T>> {
			calls.push(req);
			return { data: `from-${id}` as T };
		},
	};
	modelRegistry.register({
		id,
		label: id,
		capabilities,
		priority,
		adapter,
	});
	return adapter;
}

describe("web_extract action=summarize provider routing", () => {
	beforeEach(() => {
		modelRegistry.clear();
	});

	it("routes to registered adapter with provider=auto", async () => {
		fakeAdapter("gemini", ["summarize"]);
		const tool = createWebExtractTool();
		const result = await tool.execute(
			"call",
			{ action: "summarize", content: "page text", sentences: 1 },
			signal,
			undefined,
			{
				getFlag: () => {
					/* no-op */
				},
			},
		);
		expect(result.content[0]?.text).toContain("from-gemini");
	});

	it("routes to explicit provider id", async () => {
		fakeAdapter("ollama", ["summarize"]);
		fakeAdapter("gemini", ["summarize"]);
		const tool = createWebExtractTool();
		const result = await tool.execute(
			"call",
			{ action: "summarize", content: "page text", sentences: 1, provider: "ollama" },
			signal,
			undefined,
			{
				getFlag: () => {
					/* no-op */
				},
			},
		);
		expect(result.content[0]?.text).toContain("from-ollama");
	});

	it("returns MODEL_ADAPTER_MISSING with provider=off", async () => {
		fakeAdapter("gemini", ["summarize"]);
		const tool = createWebExtractTool();
		const result = await tool.execute(
			"call",
			{ action: "summarize", content: "page text", sentences: 1, provider: "off" },
			signal,
		);
		expect((result.details as { error?: { code: string } }).error?.code).toBe(
			"MODEL_ADAPTER_MISSING",
		);
	});

	it("returns MODEL_ADAPTER_NOT_FOUND for unknown id", async () => {
		const tool = createWebExtractTool();
		const result = await tool.execute(
			"call",
			{ action: "summarize", content: "page text", sentences: 1, provider: "nonexistent" },
			signal,
		);
		expect((result.details as { error?: { code: string } }).error?.code).toBe(
			"MODEL_ADAPTER_NOT_FOUND",
		);
	});

	it("returns MODEL_ADAPTER_INCOMPATIBLE when id lacks capability", async () => {
		fakeAdapter("extract-only", ["extract"]);
		const tool = createWebExtractTool();
		const result = await tool.execute(
			"call",
			{ action: "summarize", content: "page text", sentences: 1, provider: "extract-only" },
			signal,
		);
		expect((result.details as { error?: { code: string } }).error?.code).toBe(
			"MODEL_ADAPTER_INCOMPATIBLE",
		);
	});

	it("programmatic adapter beats registry", async () => {
		fakeAdapter("gemini", ["summarize"]);
		const tool = createWebExtractTool({
			modelAdapter: {
				async run<T>(): Promise<ModelResponse<T>> {
					return { data: "injected" as T };
				},
			},
		});
		const result = await tool.execute(
			"call",
			{ action: "summarize", content: "page text", sentences: 1 },
			signal,
		);
		expect(result.content[0]?.text).toContain("injected");
	});
});

describe("web_extract action=adhoc provider routing", () => {
	beforeEach(() => {
		modelRegistry.clear();
	});

	it("routes to registered adapter with provider=auto", async () => {
		fakeAdapter("gemini", ["extract"]);
		const tool = createWebExtractTool();
		const result = await tool.execute(
			"call",
			{ content: "page text", prompt: "extract" },
			signal,
			undefined,
			{
				getFlag: () => {
					/* no-op */
				},
			},
		);
		expect((result.details as { error?: unknown }).error).toBeUndefined();
	});

	it("routes to explicit provider id", async () => {
		fakeAdapter("ollama", ["extract"]);
		fakeAdapter("gemini", ["extract"]);
		const tool = createWebExtractTool();
		const result = await tool.execute(
			"call",
			{ content: "page text", prompt: "extract", provider: "ollama" },
			signal,
			undefined,
			{
				getFlag: () => {
					/* no-op */
				},
			},
		);
		expect((result.details as { error?: unknown }).error).toBeUndefined();
	});

	it("programmatic adapter beats registry", async () => {
		fakeAdapter("gemini", ["extract"]);
		const tool = createWebExtractTool({
			modelAdapter: {
				async run<T>(): Promise<ModelResponse<T>> {
					return { data: "injected" as T };
				},
			},
		});
		const result = await tool.execute("call", { content: "page text", prompt: "extract" }, signal);
		expect((result.details as { error?: unknown }).error).toBeUndefined();
	});

	it("returns MODEL_ADAPTER_MISSING with provider=off", async () => {
		fakeAdapter("gemini", ["extract"]);
		const tool = createWebExtractTool();
		const result = await tool.execute(
			"call",
			{ content: "page text", prompt: "extract", provider: "off" },
			signal,
		);
		expect((result.details as { error?: { code: string } }).error?.code).toBe(
			"MODEL_ADAPTER_MISSING",
		);
	});

	it("returns MODEL_ADAPTER_NOT_FOUND for unknown id", async () => {
		const tool = createWebExtractTool();
		const result = await tool.execute(
			"call",
			{ content: "page text", prompt: "extract", provider: "nonexistent" },
			signal,
		);
		expect((result.details as { error?: { code: string } }).error?.code).toBe(
			"MODEL_ADAPTER_NOT_FOUND",
		);
	});

	it("returns MODEL_ADAPTER_INCOMPATIBLE when id lacks capability", async () => {
		fakeAdapter("summarize-only", ["summarize"]);
		const tool = createWebExtractTool();
		const result = await tool.execute(
			"call",
			{ content: "page text", prompt: "extract", provider: "summarize-only" },
			signal,
		);
		expect((result.details as { error?: { code: string } }).error?.code).toBe(
			"MODEL_ADAPTER_INCOMPATIBLE",
		);
	});
});
