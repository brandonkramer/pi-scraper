/**
 * @file Web-summarize-usage **tests** module. Tests ModelUsage plumbing from adapter response
 *   through to envelope.
 */
import { describe, expect, it } from "vitest";

import type {
	ModelAdapter,
	ModelRequest,
	ModelResponse,
	ModelUsage,
} from "../../extract/adhoc/model.ts";
import type { ScrapePipelineDeps } from "../../scrape/pipeline.ts";
import { createWebSummarizeTool } from "../web-summarize.ts";

const signal = new AbortController().signal;

function mockAdapter(usage?: ModelUsage): ModelAdapter {
	return {
		async run<T>(_req: ModelRequest, _signal?: AbortSignal): Promise<ModelResponse<T>> {
			return { data: "summary text" as T, usage };
		},
	};
}

function fakeScrapeDeps(): ScrapePipelineDeps {
	const html = `<!doctype html><html><head><title>Fixture</title></head><body><main><h1>Fixture Heading</h1><p>Fixture body text.</p></main></body></html>`;
	return {
		httpClient: {
			async fetchUrl() {
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

describe("web_summarize ModelUsage forwarding", () => {
	it("forwards full usage to envelope when adapter returns it", async () => {
		const usage: ModelUsage = {
			provider: "gemini-acp",
			model: "gemini-2.0-flash",
			inputTokens: 234,
			outputTokens: 187,
			totalTokens: 421,
			costUSD: 0.0023,
		};
		const tool = createWebSummarizeTool({
			modelAdapter: mockAdapter(usage),
			scrapeDeps: fakeScrapeDeps(),
		});
		const result = await tool.execute(
			"call",
			{ url: "https://example.com/page", sentences: 3 },
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
		const tool = createWebSummarizeTool({
			modelAdapter: mockAdapter(usage),
			scrapeDeps: fakeScrapeDeps(),
		});
		const result = await tool.execute(
			"call",
			{ url: "https://example.com/page", sentences: 3 },
			signal,
		);
		const modelUsage = (result.details as { modelUsage?: ModelUsage }).modelUsage;
		expect(modelUsage?.provider).toBe("ollama");
		expect(modelUsage?.inputTokens).toBe(100);
		expect(modelUsage?.outputTokens).toBe(50);
		expect(modelUsage?.costUSD).toBeUndefined();
	});

	it("leaves modelUsage undefined when adapter returns no usage", async () => {
		const tool = createWebSummarizeTool({
			modelAdapter: mockAdapter(undefined),
			scrapeDeps: fakeScrapeDeps(),
		});
		const result = await tool.execute(
			"call",
			{ url: "https://example.com/page", sentences: 3 },
			signal,
		);
		expect((result.details as { modelUsage?: ModelUsage }).modelUsage).toBeUndefined();
	});

	it("passes through garbage usage without validation", async () => {
		const usage = {
			provider: "bad-adapter",
			inputTokens: "234" as unknown as number,
		} as ModelUsage;
		const tool = createWebSummarizeTool({
			modelAdapter: mockAdapter(usage),
			scrapeDeps: fakeScrapeDeps(),
		});
		const result = await tool.execute(
			"call",
			{ url: "https://example.com/page", sentences: 3 },
			signal,
		);
		const modelUsage = (result.details as { modelUsage?: ModelUsage }).modelUsage;
		expect(modelUsage?.provider).toBe("bad-adapter");
		expect(modelUsage?.inputTokens).toBe("234");
	});
});
