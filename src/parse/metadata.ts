import type { DomAdapter } from "./dom-adapter.js";
import { absoluteUrl } from "./selectors.js";

export interface PageMetadata {
	title?: string;
	description?: string;
	language?: string;
	canonicalUrl?: string;
	meta: Record<string, string>;
	openGraph: Record<string, string>;
	twitter: Record<string, string>;
}

export interface PageHeading {
	level: number;
	text: string;
}

export interface PageLink {
	url: string;
	text: string;
	rel?: string;
}

export function extractMetadata(
	dom: DomAdapter,
	baseUrl: string,
): PageMetadata {
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
			clean(dom.text(dom.first(dom.select("title")))) ||
			meta.title ||
			openGraph.title,
		description:
			meta.description ?? openGraph.description ?? twitter.description,
		language: dom.attr(dom.first(dom.select("html")), "lang"),
		canonicalUrl: absoluteUrl(
			dom.attr(dom.first(dom.select('link[rel="canonical"]')), "href"),
			baseUrl,
		),
		meta,
		openGraph,
		twitter,
	};
}

export function extractHeadings(dom: DomAdapter): PageHeading[] {
	const headings: PageHeading[] = [];
	for (const node of dom.nodes(dom.select("h1,h2,h3,h4,h5,h6"))) {
		const tag = dom.tagName(node);
		if (!tag) continue;
		// Level is tag[1] as number: h1->1, h2->2, etc.
		const level = tag.charCodeAt(1) - 48; // '0' is 48
		if (level < 1 || level > 6) continue;
		const text = clean(dom.text(node));
		if (text) headings.push({ level, text });
	}
	return headings;
}

export function extractLinks(dom: DomAdapter, baseUrl: string): PageLink[] {
	const links: PageLink[] = [];
	for (const node of dom.nodes(dom.select("a[href]"))) {
		const url = absoluteUrl(dom.attr(node, "href"), baseUrl);
		if (!url) continue;
		links.push({
			url,
			text: clean(dom.text(node)),
			rel: dom.attr(node, "rel"),
		});
	}
	return links;
}

function clean(value: string): string {
	return value.replace(/\s+/gu, " ").trim();
}
