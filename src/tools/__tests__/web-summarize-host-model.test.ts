/** @file Tests that web_summarize uses ctx.model when available. */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import type { ModelRequest, ModelResponse, ModelUsage } from "../../extract/adhoc/model.ts";
import type { ScrapePipelineDeps } from "../../scrape/pipeline.ts";
import { createWebSummarizeTool } from "../web-summarize.ts";

const signal = new AbortController().signal;

type HostModel = ExtensionContext["model"];

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

function mockHostModelAdapter(usage?: ModelUsage): unknown {
	return {
		async run<T>(_req: ModelRequest, _signal?: AbortSignal): Promise<ModelResponse<T>> {
			return { data: "host-model summary" as T, usage };
		},
	};
}

describe("web_summarize host model via ctx", () => {
	it("uses ctx.model when no explicit adapter is provided", async () => {
		const tool = createWebSummarizeTool({ scrapeDeps: fakeScrapeDeps() });
		const result = await tool.execute(
			"call",
			{ url: "https://example.com/page", sentences: 2 },
			signal,
			undefined,
			{ model: mockHostModelAdapter() as HostModel },
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
		const tool = createWebSummarizeTool({ scrapeDeps: fakeScrapeDeps() });
		const result = await tool.execute(
			"call",
			{ url: "https://example.com/page", sentences: 2 },
			signal,
			undefined,
			{ model: mockHostModelAdapter(usage) as HostModel },
		);
		expect((result.details as { modelUsage?: ModelUsage }).modelUsage).toEqual(usage);
	});

	it("does not emit event-bus discover when host model is available", async () => {
		const tool = createWebSummarizeTool({ scrapeDeps: fakeScrapeDeps() });
		const result = await tool.execute(
			"call",
			{ url: "https://example.com/page", sentences: 2 },
			signal,
			undefined,
			{ model: mockHostModelAdapter() as HostModel },
		);
		// If no adapter was found, the result would contain MODEL_ADAPTER_MISSING
		expect((result.details as { error?: { code: string } }).error).toBeUndefined();
		expect(result.content[0]?.text).toContain("host-model summary");
	});
});
