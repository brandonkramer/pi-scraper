import { describe, expect, it } from "vitest";
import type { ModelAdapter, ModelRequest } from "../../extract/model.js";
import type { ScrapePipelineDeps } from "../../scrape/pipeline.js";
import type { ResultEnvelope } from "../../types.js";
import type { RenderComponent, WebTool } from "../define.js";
import { registerWebTools } from "../register.js";
import { renderText } from "../render.js";
import { createWebExtractTool, webExtractTool } from "../web-extract.js";
import { webListExtractorsTool } from "../web-list-extractors.js";
import { createWebSummarizeTool } from "../web-summarize.js";

const signal = new AbortController().signal;

describe("selected web tool handlers", () => {
	it("lists vertical extractor capabilities", async () => {
		const result = await webListExtractorsTool.execute("call", {}, signal);
		expect(result.content[0]?.text).toContain("extractor");
		expect(Array.isArray((result.details as ResultEnvelope).data)).toBe(true);
	});

	it("returns structured missing-model errors for ad hoc extraction", async () => {
		const result = await webExtractTool.execute(
			"call",
			{ url: "https://example.com" },
			signal,
		);
		expect((result.details as ResultEnvelope).error?.code).toBe(
			"MODEL_ADAPTER_MISSING",
		);
		expect(result.content[0]?.text).toContain("model-backed");
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

	it("registers model-backed extract/summarize tools when a host adapter is available", async () => {
		const registered: WebTool[] = [];
		const registrar = {
			modelAdapter: fakeModelAdapter((request) =>
				request.task === "summarize" ? "registered summary" : { ok: true },
			),
			registerTool(tool: WebTool) {
				registered.push(tool);
			},
		};
		registerWebTools(registrar);
		const extract = registered.find((tool) => tool.name === "web_extract");
		const summarize = registered.find((tool) => tool.name === "web_summarize");

		const extracted = await extract?.execute(
			"call",
			{ content: "content", prompt: "extract" },
			signal,
		);
		expect(
			(extracted?.details as ResultEnvelope<{ data: { ok: boolean } }>).data
				?.data.ok,
		).toBe(true);

		const summarized = await summarize?.execute(
			"call",
			{ content: "content", sentences: 1 },
			signal,
		);
		expect(summarized?.content[0]?.text).toBe("registered summary");
	});

	it("runs provided-content and URL-backed summarization with an injected model adapter", async () => {
		const tool = createWebSummarizeTool({
			modelAdapter: fakeModelAdapter((request) =>
				request.input.includes("Fixture Heading")
					? "Summary from scraped page."
					: "Summary from provided content.",
			),
			scrapeDeps: fakeScrapeDeps(),
		});

		const provided = await tool.execute(
			"call",
			{ content: "Provided content", sentences: 1 },
			signal,
		);
		expect(provided.content[0]?.text).toBe("Summary from provided content.");

		const scraped = await tool.execute(
			"call",
			{ url: "https://example.com/page", bullets: 2, mode: "fast" },
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
		const result = await webListExtractorsTool.execute("call", {}, signal);
		expect(
			renderComponentText(webListExtractorsTool.renderCall?.({}, undefined)),
		).toBe("web_list_extractors");
		expect(
			renderComponentText(
				webListExtractorsTool.renderResult?.(
					result,
					{ expanded: true },
					undefined,
				),
			),
		).toContain("extractor");
	});

	it("wraps long custom renderer lines to the requested terminal width", () => {
		const lines = renderText("x".repeat(150)).render(40);
		expect(lines.length).toBeGreaterThan(1);
		expect(lines.every((line) => line.length <= 40)).toBe(true);
	});
});

function renderComponentText(component: RenderComponent | undefined): string {
	return component?.render(80).join("\n") ?? "";
}

function fakeModelAdapter(
	respond: (request: ModelRequest) => unknown,
): ModelAdapter {
	return {
		async run<T = unknown>(request: ModelRequest) {
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
