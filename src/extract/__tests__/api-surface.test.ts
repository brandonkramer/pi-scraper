/**
 * @fileoverview extract __tests__ api-surface.test module.
 */
import { describe, expect, it } from "vitest";
import { buildApiSurface, buildApiSurfaceFromScrapes } from "../api-surface.ts";
import type { ScrapeResult } from "../../scrape/pipeline.ts";

const typedocHtml = `<!doctype html><html><body><main>
<h1>Client Module</h1><p>Client APIs.</p>
<h2>fetchMetrics()</h2><p>Fetch current metrics.</p>
<pre><code class="language-ts">fetchMetrics(project: string): Promise&lt;Metrics&gt;</code></pre>
<h2>class MetricsClient</h2><p>Client class.</p>
<pre><code>new MetricsClient()</code></pre>
</main></body></html>`;

describe("API surface builder", () => {
	it("builds modules and symbols from rendered docs pages", () => {
		const tree = buildApiSurface([
			{
				url: "https://docs.example.com/api/client",
				html: typedocHtml,
			},
		]);

		expect(tree).toMatchObject({
			project: "docs.example.com",
			modules: [
				{
					name: "Client Module",
					functions: [
						{
							name: "fetchMetrics",
							signature: "fetchMetrics(project: string): Promise<Metrics>",
						},
					],
					classes: [{ name: "MetricsClient" }],
				},
			],
		});
		expect(tree.fallback).toBeUndefined();
	});

	it("uses docsite vertical output when available", () => {
		const tree = buildApiSurface([
			{
				url: "https://developer.mozilla.org/en-US/docs/Web/API/fetch",
				data: {
					title: "fetch()",
					version: "stable",
					apiSignature: {
						name: "fetch",
						signature: "fetch(resource, options)",
						parameters: [{ name: "resource" }],
					},
					source: { provider: "docsite" },
				},
			},
		]);

		expect(tree.version).toBe("stable");
		expect(tree.modules[0]?.functions[0]).toMatchObject({
			name: "fetch",
			signature: "fetch(resource, options)",
			parameters: [{ name: "resource" }],
		});
	});

	it("returns partial errors and flat fallback when symbols are not detected", () => {
		const tree = buildApiSurface([
			{
				url: "https://docs.example.com/guide",
				markdown: "# Guide\n\nNarrative docs only.",
			},
			{
				url: "https://docs.example.com/missing",
				error: { code: "ROBOTS_DENIED", message: "blocked" },
			},
		]);

		expect(tree.modules).toHaveLength(1);
		expect(tree.errors).toEqual([
			{
				code: "ROBOTS_DENIED",
				message: "blocked",
				url: "https://docs.example.com/missing",
			},
		]);
		expect(tree.fallback).toMatchObject({
			kind: "flat-markdown",
			pageCount: 1,
		});
	});

	it("compiles crawl scrape results", () => {
		const page = {
			url: "https://docs.example.com/api/client",
			finalUrl: "https://docs.example.com/api/client",
			data: { title: "Client", html: typedocHtml },
			error: undefined,
		} as ScrapeResult;

		expect(
			buildApiSurfaceFromScrapes([page]).modules[0]?.functions[0]?.name,
		).toBe("fetchMetrics");
	});
});
