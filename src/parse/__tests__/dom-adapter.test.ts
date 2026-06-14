/** @file Parse **tests** dom-adapter.test module. */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadDom } from "../dom/adapter.ts";

const staticHtml = `<!doctype html><html><head>
<title>Adapter Fixture</title>
<link rel="alternate" type="text/markdown" href="/page.md" title="Markdown">
<link rel="stylesheet" href="/style.css">
</head><body><main><h1>Heading</h1><p>Body <a href="/ref">link</a>.</p></main><aside>Noise</aside></body></html>`;

describe("DOM adapter", () => {
	it("selects nodes, reads attributes, and serializes selected roots", () => {
		const dom = loadDom(staticHtml);
		const alternates = dom.select('link[href][rel~="alternate"]');
		const firstAlternate = dom.nodes(alternates)[0];

		expect(dom.count(alternates)).toBe(1);
		expect(dom.attr(firstAlternate, "href")).toBe("/page.md");
		expect(dom.attr(dom.first(alternates), "type")).toBe("text/markdown");
		expect(dom.tagName(firstAlternate)).toBe("link");
		expect(dom.text(dom.select("main"))).toContain("Body link");
		expect(dom.html(dom.select("main"))).toContain("<h1>Heading</h1>");
		expect(dom.text(dom.selection(dom.nodes(dom.select("main,aside"))))).toContain("Noise");
	});

	it("supports scoped selection and explicit removal", () => {
		const dom = loadDom(staticHtml);
		const body = dom.select("body");

		expect(dom.count(dom.select("a[href]", body))).toBe(1);
		dom.remove("aside", body);
		expect(dom.text(body)).not.toContain("Noise");
	});

	it("supports root, selection removal, and empty node guards", () => {
		const dom = loadDom(staticHtml);
		const heading = dom.select("h1", dom.root());
		const missingNode = dom.nodes(dom.select("missing"))[0];

		expect(dom.text(heading)).toBe("Heading");
		dom.removeSelection(heading);
		expect(dom.text(dom.root())).not.toContain("Heading");
		expect(dom.text(missingNode)).toBe("");
		expect(dom.attr(missingNode, "href")).toBeUndefined();
		expect(dom.tagName(missingNode)).toBeUndefined();
	});

	it("keeps malformed full-document parsing scoped to selected elements", () => {
		const html = fixture("malformed-html-corpus.html");
		const dom = loadDom(html);

		expect(dom.count(dom.select("body"))).toBe(0);
		expect(dom.count(dom.select("main"))).toBe(0);
		expect(dom.text(dom.root())).toContain("Malformed Parser Stress Fixture");
	});

	it("reads raw JSON text from data-island scripts", () => {
		const dom = loadDom(fixture("data-island-parity.html"));
		const scripts = dom.select(
			'script[type="application/json"],script[type="application/ld+json"]',
		);
		const scriptText = dom
			.nodes(scripts)
			.map((node) => dom.text(node))
			.join("\n");

		expect(dom.count(scripts)).toBe(5);
		expect(scriptText).toContain("Next Payload");
		expect(scriptText).toContain("CMS rich text payload");
		expect(scriptText).toContain("Data Island Page");
	});
});

function fixture(name: string): string {
	return readFileSync(join(process.cwd(), "eval", "extraction-quality", "pages", name), "utf8");
}
