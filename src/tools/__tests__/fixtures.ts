/** @file Shared fixtures for web tool tests (no tests live here). */
import type { ModelAdapter, ModelRequest, ModelResponse } from "../../extract/adhoc/model.ts";
import type { ScrapePipelineDeps } from "../../scrape/pipeline.ts";

export const signal = new AbortController().signal;

export function fakeModelAdapter(respond: (request: ModelRequest) => unknown): ModelAdapter {
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

export function fakeScrapeDeps(): ScrapePipelineDeps {
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
