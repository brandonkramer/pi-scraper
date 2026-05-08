/**
 * @fileoverview extract verticals docs-site module.
 */
import * as cssSelect from "css-select";
import type { AnyNode, Element } from "domhandler";
import * as domutils from "domutils";
import { parseDocument } from "htmlparser2";
import { capability, type VerticalExtractor } from "../capabilities.js";
import {
	cleanText,
	stripUndefined,
	titleCase,
	truncateText,
} from "../_html.js";
import {
	extractHeadingSections,
	firstTextBySelector,
	sectionFromHeading,
	type ExtractedDocSection,
} from "../doc-structure.js";

export type DocsPlatform =
	| "docusaurus"
	| "readthedocs"
	| "gitbook"
	| "mdn"
	| "unknown";

type DocSection = ExtractedDocSection;

interface DocSiteResult {
	platform: DocsPlatform;
	version?: string;
	breadcrumbs: string[];
	title: string;
	summary?: string;
	sections: DocSection[];
	apiSignature?: {
		name: string;
		signature: string;
		parameters?: Array<{ name: string; type?: string; description?: string }>;
		returns?: { type?: string; description?: string };
	};
	source: { provider: string; finalUrl: string };
}

export const docsiteExtractor: VerticalExtractor<DocSiteResult> = {
	capability: capability(
		"docsite",
		[
			"https://:host/docs/:path*",
			"https://:host/api/:path*",
			"https://*.readthedocs.io/:path*",
			"https://*.gitbook.io/:path*",
			"https://*.gitbook.com/:path*",
			"https://gitbook.com/:path*",
			"https://developer.mozilla.org/:locale/docs/:path*",
			"https://:host/:path*",
		],
		docSiteSchema(),
	),
	match: (url) => (/^https?:$/u.test(url.protocol) ? {} : undefined),
	extract: async (url, _match, context, signal) => {
		if (context.fetchPage) {
			const page = await context.fetchPage(url.toString(), signal);
			return parseDocSite(page.text, new URL(page.finalUrl));
		}
		if (!context.fetchText)
			throw new Error("docsite extractor requires fetchText support");
		return parseDocSite(await context.fetchText(url.toString(), signal), url);
	},
};

function parseDocSite(html: string, url: URL): DocSiteResult {
	const document = parseDocument(html, {
		lowerCaseAttributeNames: true,
		lowerCaseTags: true,
	});
	const platform = detectPlatform(url, document);
	const title =
		firstTextBySelector(document, ["main h1", "article h1", "h1", "title"]) ??
		url.pathname;
	const summary =
		metaContent(document, "description") ??
		metaContent(document, "og:description");
	return {
		platform,
		version: extractVersion(url, document, platform),
		breadcrumbs: extractBreadcrumbs(document, url),
		title,
		summary,
		sections: extractSections(document),
		apiSignature:
			platform === "mdn" ? extractMdnSignature(document, title) : undefined,
		source: { provider: "docsite", finalUrl: url.toString() },
	};
}

function docSiteSchema() {
	return {
		type: "object",
		required: ["platform", "breadcrumbs", "title", "sections", "source"],
		properties: {
			platform: { type: "string" },
			version: { type: "string" },
			breadcrumbs: { type: "array", items: { type: "string" } },
			title: { type: "string" },
			summary: { type: "string" },
			sections: { type: "array", items: { type: "object" } },
			apiSignature: { type: "object" },
			source: { type: "object" },
		},
	};
}

function detectPlatform(url: URL, document: AnyNode): DocsPlatform {
	const host = url.hostname.toLowerCase();
	if (host === "developer.mozilla.org") return "mdn";
	if (host.endsWith(".readthedocs.io") || host === "readthedocs.io")
		return "readthedocs";
	if (
		host.endsWith(".gitbook.io") ||
		host.endsWith(".gitbook.com") ||
		host === "gitbook.com"
	)
		return "gitbook";
	if (
		cssSelect.selectOne(
			'html[data-theme], .theme-doc-markdown, .navbar-sidebar, script[src*="docusaurus"]',
			document,
		)
	)
		return "docusaurus";
	if (cssSelect.selectOne(".wy-nav-side, .rst-content", document))
		return "readthedocs";
	if (
		cssSelect.selectOne(
			'[class*="gitbook"], [data-testid="page.outline"]',
			document,
		)
	)
		return "gitbook";
	const firstPart = url.pathname.split("/").filter(Boolean)[0];
	return firstPart === "docs" || firstPart === "api" ? "docusaurus" : "unknown";
}

function extractVersion(
	url: URL,
	document: AnyNode,
	platform: DocsPlatform,
): string | undefined {
	const metaVersion =
		metaContent(document, "version") ??
		metaContent(document, "docsearch:version");
	if (metaVersion) return metaVersion;
	const parts = url.pathname.split("/").filter(Boolean);
	if (platform === "readthedocs") {
		return parts[1] && /^[a-z]{2}$/iu.test(parts[0] ?? "")
			? parts[1]
			: parts[0];
	}
	if (platform === "docusaurus" && ["docs", "api"].includes(parts[0] ?? "")) {
		return looksLikeVersion(parts[1]) ? parts[1] : undefined;
	}
	return undefined;
}

function extractBreadcrumbs(document: AnyNode, url: URL): string[] {
	const selectors = [
		"nav[aria-label*=breadcrumb i] a, nav[aria-label*=breadcrumb i] li, .breadcrumbs a, .breadcrumbs li, .breadcrumbs span",
		".wy-breadcrumbs a, .wy-breadcrumbs li, .breadcrumb a, .breadcrumb li",
	];
	for (const selector of selectors) {
		const values = [
			...new Set(
				cssSelect
					.selectAll(selector, document)
					.map((node) => cleanText(domutils.textContent(node)))
					.filter(Boolean),
			),
		];
		if (values.length) return values;
	}
	return url.pathname.split("/").filter(Boolean).slice(0, -1).map(titleCase);
}

function extractSections(document: AnyNode): DocSection[] {
	const root =
		cssSelect.selectOne(
			"article, main, .theme-doc-markdown, .rst-content .document, .markdown-section",
			document,
		) ?? document;
	return extractHeadingSections(root, { contentChars: 1200 });
}

function extractMdnSignature(
	document: AnyNode,
	title: string,
): DocSiteResult["apiSignature"] {
	const signature =
		firstTextBySelector(document, ["pre.syntaxbox", "pre code", "pre"]) ?? "";
	if (!signature.includes("(") && !title.includes("()")) return undefined;
	const parameters: Array<{ name: string; description?: string }> = [];
	for (const node of cssSelect.selectAll("dt", document)) {
		const code = cssSelect.selectOne("code", node);
		const name = cleanText(domutils.textContent(code ?? node));
		const description = cleanText(textOf((node as { next?: AnyNode }).next));
		if (name) parameters.push(stripUndefined({ name, description }));
	}
	return stripUndefined({
		name: title.replace(/\s*\(.*$/u, "").trim(),
		signature: signature || title,
		parameters: parameters.length ? parameters : undefined,
		returns: extractReturns(document),
	});
}

function extractReturns(
	document: AnyNode,
): { type?: string; description?: string } | undefined {
	const returnsHeading = cssSelect
		.selectAll("h2,h3", document)
		.filter((node): node is Element => domutils.isTag(node))
		.find((node) => /returns?/iu.test(domutils.textContent(node)));
	if (!returnsHeading) return undefined;
	const section = sectionFromHeading(returnsHeading);
	const description = section.content
		? truncateText(cleanText(section.content), 500)
		: undefined;
	return description ? { description } : undefined;
}

function metaContent(document: AnyNode, name: string): string | undefined {
	const node = cssSelect.selectOne(
		`meta[name="${name}"],meta[property="${name}"]`,
		document,
	);
	return node && domutils.isTag(node)
		? domutils.getAttributeValue(node, "content")
		: undefined;
}

function textOf(node: AnyNode | null | undefined): string {
	return node ? domutils.textContent(node) : "";
}

function looksLikeVersion(value?: string): boolean {
	return Boolean(
		value && /^(?:v?\d+(?:\.\d+){0,3}|latest|next|stable)$/iu.test(value),
	);
}
