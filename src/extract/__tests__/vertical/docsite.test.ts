/**
 * @fileoverview extract __tests__ docsite.test module.
 */
import { describe, expect, it } from "vitest";
import type { VerticalExtractorContext } from "../../vertical/capabilities.ts";
import { runVerticalExtractor } from "../../vertical/registry.ts";

const pages: Record<string, string> = {
	"https://docusaurus.example/docs/3.0/api/client": `<!doctype html><html data-theme="light"><head><title>Client API</title><meta name="docsearch:version" content="3.0"><meta name="description" content="Client reference."></head><body><nav class="breadcrumbs"><a>Docs</a><a>3.0</a><span>Client API</span></nav><main class="theme-doc-markdown"><h1 id="client-api">Client API</h1><p>Create a client.</p><h2 id="usage">Usage</h2><p>Call the constructor.</p><pre><code class="language-ts">new Client()</code></pre></main></body></html>`,
	"https://pkg.readthedocs.io/en/stable/api/": `<!doctype html><html><body><div class="wy-nav-side"></div><ul class="wy-breadcrumbs"><li>Docs</li><li>stable</li><li>API</li></ul><div class="rst-content"><div class="document"><h1>API Reference</h1><p>Sphinx generated API.</p><h2>pkg.Client</h2><p>Client class.</p></div></div></body></html>`,
	"https://team.gitbook.io/project/intro": `<!doctype html><html><body><aside class="gitbook-sidebar"><a>Intro</a></aside><main class="markdown-section"><h1>Getting started</h1><p>Install the product.</p><h2>Next steps</h2><p>Configure it.</p></main></body></html>`,
	"https://gitbook.com/docs": `<!doctype html><html data-theme="light"><body><main><h1>GitBook docs</h1><p>Hosted docs.</p></main></body></html>`,
	"https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API": `<!doctype html><html><head><meta name="description" content="Fetch API reference"></head><body><nav aria-label="breadcrumb"><ol><li>Web</li><li>API</li></ol></nav><main><h1>fetch()</h1><p>The fetch method.</p><h2>Syntax</h2><pre class="syntaxbox">fetch(resource, options)</pre><h2>Parameters</h2><dl><dt><code>resource</code></dt><dd>The resource URL.</dd></dl><h2>Return value</h2><p>A Promise.</p></main></body></html>`,
	"https://example.com/page": `<!doctype html><html><head><title>Plain page</title></head><body><main><h1>Plain page</h1><p>Generic content.</p></main></body></html>`,
};

const context: VerticalExtractorContext = {
	fetchJson: async () => {
		throw new Error("JSON fetch should not be used for docsite fixtures");
	},
	fetchText: async (url) => pages[url] ?? "",
};

describe("docsite vertical extractor", () => {
	it("extracts Docusaurus breadcrumbs, version, sections, and code blocks", async () => {
		const result = await runVerticalExtractor(
			"docsite",
			"https://docusaurus.example/docs/3.0/api/client",
			{ context },
		);

		expect(result.error).toBeUndefined();
		expect(result.data).toMatchObject({
			platform: "docusaurus",
			version: "3.0",
			title: "Client API",
			breadcrumbs: ["Docs", "3.0", "Client API"],
		});
		expect((result.data as { sections?: unknown[] }).sections).toHaveLength(2);
		expect(result.data).toMatchObject({
			sections: [
				{ heading: "Client API", level: 1 },
				{
					heading: "Usage",
					codeBlocks: [{ language: "ts", code: "new Client()" }],
				},
			],
		});
	});

	it("detects ReadTheDocs and GitBook structures", async () => {
		await expect(
			runVerticalExtractor(
				"docsite",
				"https://pkg.readthedocs.io/en/stable/api/",
				{ context },
			),
		).resolves.toMatchObject({
			data: {
				platform: "readthedocs",
				version: "stable",
				title: "API Reference",
			},
		});
		await expect(
			runVerticalExtractor("docsite", "https://team.gitbook.io/project/intro", {
				context,
			}),
		).resolves.toMatchObject({
			data: { platform: "gitbook", title: "Getting started" },
		});
		await expect(
			runVerticalExtractor("docsite", "https://gitbook.com/docs", { context }),
		).resolves.toMatchObject({
			data: { platform: "gitbook", title: "GitBook docs" },
		});
	});

	it("extracts MDN API signature fields when available", async () => {
		await expect(
			runVerticalExtractor(
				"docsite",
				"https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API",
				{ context },
			),
		).resolves.toMatchObject({
			data: {
				platform: "mdn",
				title: "fetch()",
				apiSignature: {
					name: "fetch",
					signature: "fetch(resource, options)",
					parameters: [{ name: "resource" }],
					returns: { description: "A Promise." },
				},
			},
		});
	});

	it("falls back to unknown platform for generic pages", async () => {
		await expect(
			runVerticalExtractor("docsite", "https://example.com/page", { context }),
		).resolves.toMatchObject({
			data: { platform: "unknown", title: "Plain page" },
		});
	});
});
