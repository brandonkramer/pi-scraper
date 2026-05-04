import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractBrandIdentity } from "../../brand/extract.js";
import { htmlToMarkdown } from "../../serialize/markdown.js";
import { normalizeWhitespace } from "../../serialize/text.js";
import { discoverAlternateLinksFromDom } from "../alternates.js";
import type { DomAdapter } from "../dom-adapter.js";
import { loadDom } from "../dom-adapter.js";
import { extractFastPage, type FastExtractOptions } from "../fast.js";
import { absoluteUrl } from "../selectors.js";
import { loadHtmlparser2Dom } from "./htmlparser2-dom-adapter.js";

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
	{
		name: "SPA data islands",
		file: "spa-data-islands.html",
		options: {},
	},
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
		const cheerio = projectFastSignals(loadDom(html), baseUrl, options);
		const htmlparser2 = projectFastSignals(
			loadHtmlparser2Dom(html),
			baseUrl,
			options,
		);

		expect(cheerio).toEqual(production);
		expect(htmlparser2).toEqual(production);
	});

	it("runs alternate-link discovery through both adapter backends", () => {
		const html = fixture("github-data-island-parity.html");

		expect(
			discoverAlternateLinksFromDom(loadHtmlparser2Dom(html), baseUrl),
		).toEqual(discoverAlternateLinksFromDom(loadDom(html), baseUrl));
	});

	it("preserves brand metadata and asset signals with the htmlparser2 adapter", () => {
		const html = fixture("github-data-island-parity.html");
		const production = extractBrandIdentity(html, baseUrl);
		const adapter = brandSignals(loadHtmlparser2Dom(html), baseUrl);

		expect(adapter).toEqual({
			name: production.name,
			description: production.description,
			metadata: production.metadata,
			openGraph: production.openGraph,
			twitter: production.twitter,
			themeColors: production.themeColors,
			assetUrls: production.assets.map((asset) => asset.url).sort(),
			schemaNames: production.schema.map((item) => item.name).filter(Boolean),
		});
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

function projectFastSignals(
	dom: DomAdapter,
	url: string,
	options: FastExtractOptions,
) {
	// This intentionally mirrors production extraction using DomAdapter operations;
	// it is a parity guard, not the production parser port itself.
	const dataIslands = dataIslandTexts(dom);
	prepare(dom, options);
	const metadata = metadataSignals(dom, url);
	const root = extractionRoot(dom, options);
	return {
		title: metadata.title,
		description: metadata.description,
		metadata,
		headings: headingSignals(dom),
		links: linkSignals(dom, url),
		text: normalizeWhitespace(dom.text(root)),
		markdown: htmlToMarkdown(dom.html(root)),
		dataIslandTexts: dataIslands,
		recoveredKinds: recoveredKinds(dom),
	};
}

function prepare(dom: DomAdapter, options: FastExtractOptions): void {
	dom.remove("script,style,noscript,template,iframe,canvas");
	if (options.removeImages) dom.remove("img,picture,source");
	for (const selector of options.exclude ?? []) dom.remove(selector);
}

function extractionRoot(dom: DomAdapter, options: FastExtractOptions) {
	const include = options.include?.filter(Boolean) ?? [];
	if (include.length > 0) {
		return dom.selection(
			dedupeNodes(
				include.flatMap((selector) => dom.nodes(dom.select(selector))),
			),
		);
	}
	if (options.onlyMainContent && dom.count(dom.select("main")) > 0) {
		return dom.select("main");
	}
	if (dom.count(dom.select("body")) > 0) return dom.select("body");
	// Cheerio keeps an empty body for some malformed full documents where the
	// alternative parser may see an html element but no usable body content.
	if (dom.count(dom.select("html")) > 0) return dom.selection([]);
	return dom.root();
}

function dedupeNodes(
	nodes: ReturnType<DomAdapter["nodes"]>,
): ReturnType<DomAdapter["nodes"]> {
	return [...new Set(nodes)];
}

function metadataSignals(dom: DomAdapter, url: string) {
	const meta: Record<string, string> = {};
	const openGraph: Record<string, string> = {};
	const twitter: Record<string, string> = {};
	for (const node of dom.nodes(dom.select("meta"))) {
		const key =
			dom.attr(node, "name") ??
			dom.attr(node, "property") ??
			dom.attr(node, "http-equiv");
		const content = dom.attr(node, "content");
		if (!key || !content) continue;
		meta[key] = content;
		if (key.startsWith("og:")) openGraph[key.slice(3)] = content;
		if (key.startsWith("twitter:")) twitter[key.slice(8)] = content;
	}
	return {
		title:
			clean(dom.text(dom.first(dom.select("head > title")))) ||
			meta.title ||
			openGraph.title,
		description:
			meta.description ?? openGraph.description ?? twitter.description,
		language: dom.attr(dom.first(dom.select("html")), "lang"),
		canonicalUrl: absoluteUrl(
			dom.attr(dom.first(dom.select('link[rel~="canonical"]')), "href"),
			url,
		),
		meta,
		openGraph,
		twitter,
	};
}

function headingSignals(dom: DomAdapter) {
	return dom.nodes(dom.select("h1,h2,h3,h4,h5,h6")).flatMap((node) => {
		const tag = dom.tagName(node);
		const text = clean(dom.text(node));
		return tag && text
			? [{ level: Number.parseInt(tag.slice(1), 10), text }]
			: [];
	});
}

function linkSignals(dom: DomAdapter, url: string) {
	return dom.nodes(dom.select("a[href]")).flatMap((node) => {
		const href = absoluteUrl(dom.attr(node, "href"), url);
		return href
			? [{ url: href, text: clean(dom.text(node)), rel: dom.attr(node, "rel") }]
			: [];
	});
}

function dataIslandTexts(dom: DomAdapter): string[] {
	return dom.nodes(dom.select("script")).flatMap((node) => {
		const type = islandType(
			dom.attr(node, "type")?.toLowerCase() ?? "",
			dom.attr(node, "id") ?? "",
		);
		if (!type) return [];
		const parsed = safeJson(dom.text(node).trim());
		const text = normalizeWhitespace(collectUsefulStrings(parsed).join("\n"));
		return text ? [text] : [];
	});
}

function islandType(type: string, id: string): boolean {
	return (
		type === "application/ld+json" ||
		type === "application/json" ||
		id === "__NEXT_DATA__"
	);
}

function collectUsefulStrings(
	value: unknown,
	parentKey = "",
	out: string[] = [],
): string[] {
	const keys = new Set([
		"title",
		"name",
		"headline",
		"description",
		"text",
		"articleBody",
		"content",
		"summary",
	]);
	if (typeof value === "string") {
		if (keys.has(parentKey) || (value.length >= 40 && /\s/u.test(value)))
			out.push(value);
	} else if (Array.isArray(value)) {
		for (const entry of value) collectUsefulStrings(entry, parentKey, out);
	} else if (value && typeof value === "object") {
		for (const [key, entry] of Object.entries(value))
			collectUsefulStrings(entry, key, out);
	}
	return out;
}

function recoveredKinds(dom: DomAdapter): string[] {
	const recovered = [];
	for (const node of dom.nodes(
		dom.select(
			"h1,h2,[class*=hero],[id*=hero],[class*=announcement],[role=banner]",
		),
	)) {
		const text = clean(dom.text(node));
		if (!text) continue;
		const tag = dom.tagName(node) ?? "";
		const kind = /^h[12]$/iu.test(tag)
			? "heading"
			: text.toLowerCase().includes("announce")
				? "announcement"
				: "hero";
		recovered.push({ kind, text, url: "" });
	}
	for (const node of dom.nodes(
		dom.select('footer a[href],nav[aria-label*="footer" i] a[href]'),
	)) {
		const text = clean(dom.text(node));
		const url = absoluteUrl(dom.attr(node, "href"), baseUrl);
		if (text && url) recovered.push({ kind: "footer_link", text, url });
	}
	const seen = new Set<string>();
	return recovered.flatMap((item) => {
		const key = `${item.kind}:${item.text}:${item.url}`;
		if (seen.has(key)) return [];
		seen.add(key);
		return [item.kind];
	});
}

function brandSignals(dom: DomAdapter, url: string) {
	const metadata = metadataSignals(dom, url).meta;
	const openGraph = prefixed(metadata, "og:");
	const twitter = prefixed(metadata, "twitter:");
	return {
		name:
			schemaNames(dom)[0] ??
			openGraph.site_name ??
			openGraph.title ??
			metadata["application-name"] ??
			(clean(dom.text(dom.first(dom.select("title")))) || undefined),
		description:
			metadata.description ?? openGraph.description ?? twitter.description,
		metadata,
		openGraph,
		twitter,
		themeColors: dom
			.nodes(dom.select('meta[name="theme-color"][content]'))
			.map((node) => dom.attr(node, "content")?.trim())
			.filter(Boolean),
		assetUrls: brandAssetUrls(dom, url),
		schemaNames: schemaNames(dom),
	};
}

function brandAssetUrls(dom: DomAdapter, url: string): string[] {
	const urls = [];
	for (const node of dom.nodes(
		dom.select('meta[property="og:image"],meta[name="twitter:image"]'),
	)) {
		const assetUrl = absoluteUrl(dom.attr(node, "content"), url);
		if (assetUrl) urls.push(assetUrl);
	}
	return urls.sort();
}

function schemaNames(dom: DomAdapter): string[] {
	return dom
		.nodes(dom.select('script[type="application/ld+json"]'))
		.flatMap((node) => {
			const parsed = safeJson(dom.text(node));
			const records = Array.isArray(parsed) ? parsed : [parsed];
			return records.flatMap((record) => {
				if (!record || typeof record !== "object") return [];
				const item = record as Record<string, unknown>;
				return item["@type"] === "WebSite" && typeof item.name === "string"
					? [item.name]
					: [];
			});
		});
}

function prefixed(
	input: Record<string, string>,
	prefix: string,
): Record<string, string> {
	return Object.fromEntries(
		Object.entries(input)
			.filter(([key]) => key.startsWith(prefix))
			.map(([key, value]) => [key.slice(prefix.length), value]),
	);
}

function safeJson(text: string): unknown {
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return undefined;
	}
}

function clean(value: string): string {
	return value.replace(/\s+/gu, " ").trim();
}

function fixture(name: string): string {
	return readFileSync(join(process.cwd(), "eval", "fixtures", name), "utf8");
}
