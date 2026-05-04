import { type DomAdapter, loadDom } from "./dom-adapter.js";
import { absoluteUrl } from "./selectors.js";

export interface AlternateLink {
	url: string;
	rel: string;
	type?: string;
	title?: string;
	isAgentReadable: boolean;
}

const AGENT_TYPES = new Set([
	"text/markdown",
	"text/plain",
	"application/json",
	"application/ld+json",
]);

export function discoverAlternateLinks(
	html: string,
	baseUrl: string,
): AlternateLink[] {
	return discoverAlternateLinksFromDom(loadDom(html), baseUrl);
}

export function discoverAlternateLinksFromDom(
	dom: DomAdapter,
	baseUrl: string,
): AlternateLink[] {
	const links: AlternateLink[] = [];
	for (const node of dom.nodes(
		dom.select('link[href],a[href][rel~="alternate"]'),
	)) {
		const rel = dom.attr(node, "rel") ?? "";
		if (!rel.includes("alternate") && dom.tagName(node) === "link") continue;
		const url = absoluteUrl(dom.attr(node, "href"), baseUrl);
		if (!url) continue;
		const type = dom.attr(node, "type");
		links.push({
			url,
			rel,
			type,
			title: dom.attr(node, "title"),
			isAgentReadable: isAgentReadableAlternate(url, type),
		});
	}
	return links;
}

export function isAgentReadableAlternate(url: string, type?: string): boolean {
	const lower = url.toLowerCase();
	return (
		(type !== undefined && AGENT_TYPES.has(type.toLowerCase())) ||
		lower.endsWith(".md") ||
		lower.endsWith(".markdown") ||
		lower.endsWith(".txt") ||
		lower.includes("llms.txt")
	);
}
