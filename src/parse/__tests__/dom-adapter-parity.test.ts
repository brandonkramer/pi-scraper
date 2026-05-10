/**
 * @fileoverview parse __tests__ dom-adapter-parity.test module.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { htmlToMarkdown } from "../../serialize/markdown.ts";
import { discoverAlternateLinksFromDom } from "../alternates.ts";
import { loadDom } from "../dom-adapter.ts";
import {
	extractFastPage,
	extractFastPageFromDom,
	type FastExtractOptions,
} from "../fast.ts";
import { loadHtmlparser2Dom } from "../htmlparser2-dom-adapter.ts";

const baseUrl = "https://example.com/docs/page";

const cases: Array<{
	name: string;
	file: string;
	options: FastExtractOptions;
}> = [
	{
		name: "static article with main content and image removal",
		file: "static-article.html",
		options: { onlyMainContent: true, removeImages: true },
	},
	{
		name: "noisy marketing page with exclude selector",
		file: "noisy-marketing-page.html",
		options: { exclude: ["nav", ".ads"], removeImages: true },
	},
	{
		name: "malformed full document root fallback",
		file: "malformed-html-corpus.html",
		options: {},
	},
	{ name: "SPA data islands", file: "spa-data-islands.html", options: {} },
	{
		name: "large docs page with multiple include roots",
		file: "large-docs-page.html",
		options: { include: ["main", "footer"] },
	},
	{
		name: "GitHub-style JSON data islands",
		file: "github-data-island-parity.html",
		options: { onlyMainContent: true },
	},
];

describe("DOM adapter production parity", () => {
	it.each(cases)("matches production fast extraction for $name", ({
		file,
		options,
	}) => {
		const html = fixture(file);
		const production = projectFast(extractFastPage(html, baseUrl, options));
		const htmlparser2Dom = projectFast(
			extractFastPageFromDom(loadHtmlparser2Dom(html), baseUrl, options),
		);

		expect(htmlparser2Dom).toEqual(production);
	});

	it("runs alternate-link discovery through the htmlparser2 adapter", () => {
		const html = fixture("github-data-island-parity.html");

		expect(
			discoverAlternateLinksFromDom(loadHtmlparser2Dom(html), baseUrl),
		).toEqual(discoverAlternateLinksFromDom(loadDom(html), baseUrl));
	});
});

function projectFast(result: ReturnType<typeof extractFastPage>) {
	return {
		title: result.title,
		description: result.description,
		metadata: result.metadata,
		headings: result.headings,
		links: result.links,
		text: result.text,
		markdown: htmlToMarkdown(result.html),
		dataIslandTexts: result.dataIslands.map((island) => island.text),
		recoveredKinds: result.recovered.map((item) => item.kind),
	};
}

function fixture(name: string): string {
	return readFileSync(join(process.cwd(), "eval", "fixtures", name), "utf8");
}
