import type { DomAdapter } from "../dom/adapter.ts";
import { absoluteUrl } from "../dom/selectors.ts";
/** @file Parse metadata module. */
import {
	cleanDomText,
	extractDomHeadings,
	extractDomLinks,
	type DomHeading,
	type DomLink,
} from "./elements.ts";

export interface PageMetadata {
	title?: string;
	description?: string;
	language?: string;
	canonicalUrl?: string;
	meta: Record<string, string>;
	openGraph: Record<string, string>;
	twitter: Record<string, string>;
}

export type PageHeading = DomHeading;

export type PageLink = DomLink;

export function extractMetadata(dom: DomAdapter, baseUrl: string): PageMetadata {
	const meta: Record<string, string> = {};
	const openGraph: Record<string, string> = {};
	const twitter: Record<string, string> = {};
	for (const node of dom.nodes(dom.select("meta"))) {
		const key =
			dom.attr(node, "name") ?? dom.attr(node, "property") ?? dom.attr(node, "http-equiv");
		const content = dom.attr(node, "content");
		if (!key || !content) continue;
		meta[key] = content;
		if (key.startsWith("og:")) openGraph[key.slice(3)] = content;
		if (key.startsWith("twitter:")) twitter[key.slice(8)] = content;
	}
	return {
		title: cleanDomText(dom.text(dom.first(dom.select("title")))) || meta.title || openGraph.title,
		description:
			// oxlint-disable-next-line typescript/no-unnecessary-condition -- capture group/optional field may be undefined at runtime
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
	return extractDomHeadings(dom);
}

export function extractLinks(dom: DomAdapter, baseUrl: string): PageLink[] {
	return extractDomLinks(dom, baseUrl);
}
