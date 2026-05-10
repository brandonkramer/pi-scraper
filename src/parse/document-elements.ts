/**
 * @fileoverview Shared DOM document element extraction helpers.
 */
import type { DomAdapter } from "./dom-adapter.ts";
import { absoluteUrl } from "./selectors.ts";

export interface DomHeading {
	level: number;
	text: string;
}

export interface DomLink {
	url: string;
	text: string;
	rel?: string;
}

export function cleanDomText(value: string): string {
	return value.replace(/\s+/gu, " ").trim();
}

export function extractDomHeadings(dom: DomAdapter): DomHeading[] {
	const headings: DomHeading[] = [];
	for (const node of dom.nodes(dom.select("h1,h2,h3,h4,h5,h6"))) {
		const tag = dom.tagName(node);
		if (!tag) continue;
		const level = Number.parseInt(tag.slice(1), 10);
		if (level < 1 || level > 6) continue;
		const text = cleanDomText(dom.text(node));
		if (text) headings.push({ level, text });
	}
	return headings;
}

export function extractDomLinks(dom: DomAdapter, baseUrl: string): DomLink[] {
	const links: DomLink[] = [];
	for (const node of dom.nodes(dom.select("a[href]"))) {
		const url = absoluteUrl(dom.attr(node, "href"), baseUrl);
		if (!url) continue;
		links.push({
			url,
			text: cleanDomText(dom.text(node)),
			rel: dom.attr(node, "rel"),
		});
	}
	return links;
}
