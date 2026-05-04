import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	extractBrandIdentity,
	extractBrandIdentityFromDom,
} from "../../brand/extract.js";
import { htmlToMarkdown } from "../../serialize/markdown.js";
import { discoverAlternateLinksFromDom } from "../alternates.js";
import { loadCheerioDom, loadDom } from "../dom-adapter.js";
import {
	extractFastPage,
	extractFastPageFromDom,
	type FastExtractOptions,
} from "../fast.js";
import { loadHtmlparser2Dom } from "../htmlparser2-dom-adapter.js";

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
		const cheerioDom = projectFast(
			extractFastPageFromDom(loadCheerioDom(html), baseUrl, options),
		);
		const htmlparser2Dom = projectFast(
			extractFastPageFromDom(loadHtmlparser2Dom(html), baseUrl, options),
		);

		expect(cheerioDom).toEqual(production);
		expect(htmlparser2Dom).toEqual(production);
	});

	it("runs alternate-link discovery through both adapter backends", () => {
		const html = fixture("github-data-island-parity.html");

		expect(
			discoverAlternateLinksFromDom(loadHtmlparser2Dom(html), baseUrl),
		).toEqual(discoverAlternateLinksFromDom(loadCheerioDom(html), baseUrl));
	});

	it("preserves brand identity signals with both adapter backends", () => {
		const html = fixture("github-data-island-parity.html");
		const production = projectBrand(extractBrandIdentity(html, baseUrl));
		const cheerioDom = projectBrand(
			extractBrandIdentityFromDom(loadCheerioDom(html), baseUrl),
		);
		const htmlparser2Dom = projectBrand(
			extractBrandIdentityFromDom(loadHtmlparser2Dom(html), baseUrl),
		);

		expect(cheerioDom).toEqual(production);
		expect(htmlparser2Dom).toEqual(production);
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

function projectBrand(result: ReturnType<typeof extractBrandIdentity>) {
	return {
		name: result.name,
		description: result.description,
		metadata: result.metadata,
		openGraph: result.openGraph,
		twitter: result.twitter,
		themeColors: result.themeColors,
		colorValues: result.colors.map((item) => item.value),
		fontValues: result.fonts.map((item) => item.value),
		assets: result.assets.map((asset) => ({
			url: asset.url,
			kind: asset.kind,
			source: asset.source,
		})),
		schema: result.schema,
		manifest: result.manifest,
	};
}

function fixture(name: string): string {
	return readFileSync(join(process.cwd(), "eval", "fixtures", name), "utf8");
}
