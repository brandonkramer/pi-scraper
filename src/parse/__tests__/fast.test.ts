/**
 * @fileoverview parse __tests__ fast.test module.
 */
import { describe, expect, it } from "vitest";
import { discoverAlternateLinks } from "../discovery/alternates.ts";
import { recoverDataIslands } from "../page/data-islands.ts";
import { loadDom } from "../dom/adapter.ts";
import { extractFastPage } from "../page/fast.ts";
import { likelyAgentReadableUrls, parseLlmsTxt } from "../discovery/llms.ts";
import { routeContentType } from "../content/route.ts";

const fixture = `<!doctype html><html lang="en"><head>
<title>Example Article</title><meta name="description" content="A useful article">
<meta property="og:title" content="OG Title"><link rel="canonical" href="/article">
<link rel="alternate" type="text/markdown" href="/article.md" title="Markdown">
</head><body><header class="hero"><h1>Hero Headline</h1></header>
<main><article><h2>Section</h2><p>First paragraph with <a href="/ref">a reference</a>.</p><img src="x.png"><p>Second paragraph has enough useful visible text for extraction.</p></article></main>
<nav class="ads">Advertisement noise</nav><footer><a href="/sitemap">Sitemap</a></footer></body></html>`;

describe("extractFastPage", () => {
	it("extracts metadata, headings, links, visible text, and main content", () => {
		const result = extractFastPage(fixture, "https://example.com/base", {
			exclude: [".ads"],
			onlyMainContent: true,
			removeImages: true,
		});
		expect(result.title).toBe("Example Article");
		expect(result.description).toBe("A useful article");
		expect(result.metadata.canonicalUrl).toBe("https://example.com/article");
		expect(result.headings.map((heading) => heading.text)).toContain(
			"Hero Headline",
		);
		expect(
			result.links.some((link) => link.url === "https://example.com/ref"),
		).toBe(true);
		expect(result.text).toContain("Second paragraph");
		expect(result.text).not.toContain("Advertisement noise");
		expect(result.html).not.toContain("<img");
		expect(result.recovered.some((item) => item.kind === "footer_link")).toBe(
			true,
		);
		expect(result.mainCandidates[0]?.selector).toBe("main");
	});

	it("honors include selectors", () => {
		const result = extractFastPage(fixture, "https://example.com/base", {
			include: ["footer"],
		});
		expect(result.text).toBe("Sitemap");
	});

	it("skips main-content ranking unless requested", () => {
		expect(
			extractFastPage(fixture, "https://example.com/base").mainCandidates,
		).toEqual([]);
		expect(
			extractFastPage(fixture, "https://example.com/base", {
				includeMainCandidates: true,
			}).mainCandidates[0]?.selector,
		).toBe("main");
	});
});

describe("alternates and llms helpers", () => {
	it("discovers agent-readable alternate links without fetching", () => {
		const links = discoverAlternateLinks(fixture, "https://example.com/base");
		expect(links).toEqual([
			expect.objectContaining({
				url: "https://example.com/article.md",
				isAgentReadable: true,
			}),
		]);
	});

	it("plans likely markdown and llms.txt URLs", () => {
		expect(
			likelyAgentReadableUrls("https://example.com/docs/page?utm_source=x"),
		).toEqual([
			{ url: "https://example.com/docs/page.md", kind: "markdown_sibling" },
			{ url: "https://example.com/llms.txt", kind: "llms_txt" },
		]);
	});

	it("parses llms.txt markdown links", () => {
		expect(
			parseLlmsTxt(
				"- [Guide](/guide.md)\n- https://example.com/api.md",
				"https://example.com",
			),
		).toEqual([
			{ url: "https://example.com/guide.md", kind: "llms_entry" },
			{ url: "https://example.com/api.md", kind: "llms_entry" },
		]);
	});
});

describe("data islands and content routing", () => {
	it("recovers JSON-LD and hydration text", () => {
		const dom =
			loadDom(`<script type="application/ld+json">{"headline":"Structured Title","articleBody":"Structured body text with useful content."}</script>
<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"title":"Next Title","description":"Next description with enough words."}}}</script>`);
		const islands = recoverDataIslands(dom);
		expect(islands.map((island) => island.title)).toContain("Structured Title");
		expect(islands.map((island) => island.text).join("\n")).toContain(
			"Next description",
		);
	});

	it.each([
		["application/json", "https://example.com/data", "json"],
		["text/markdown", "https://example.com/page", "markdown"],
		["image/svg+xml", "https://example.com/logo", "svg"],
		["application/pdf", "https://example.com/file", "pdf"],
		["application/octet-stream", "https://example.com/file.bin", "binary"],
	] as const)("routes %s as %s", (contentType, url, kind) => {
		expect(routeContentType(contentType, url).kind).toBe(kind);
	});
});
