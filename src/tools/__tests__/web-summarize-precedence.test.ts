/** @file Tests model-adapter resolution precedence for web_summarize. */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import type { ModelAdapter, ModelRequest, ModelResponse } from "../../extract/adhoc/model.ts";
import type { ScrapePipelineDeps } from "../../scrape/pipeline.ts";
import { modelRegistry } from "../infra/model-registry.ts";
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

describe("web_summarize adapter resolution precedence", () => {
	it("options.modelAdapter beats ctx.model", async () => {
		const injected = makeAdapter("injected");
		const host = makeAdapter("host");
		const tool = createWebSummarizeTool({
			modelAdapter: injected.adapter as unknown as ModelAdapter,
			scrapeDeps: fakeScrapeDeps(),
		});
		const result = await tool.execute(
			"call",
			{ url: "https://example.com/page", sentences: 2 },
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
		const tool = createWebSummarizeTool({ scrapeDeps: fakeScrapeDeps() });
		const result = await tool.execute(
			"call",
			{ url: "https://example.com/page", sentences: 2 },
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
		const tool = createWebSummarizeTool({ scrapeDeps: fakeScrapeDeps() });
		const result = await tool.execute(
			"call",
			{ url: "https://example.com/page", sentences: 2 },
			signal,
		);
		expect(result.content[0]?.text).toContain("from-registry");
		expect(registered.calls.length).toBe(1);
	});
});
