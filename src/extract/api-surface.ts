/**
 * @fileoverview Builds a small hierarchical API-surface tree from already-fetched documentation pages.
 *
 * The module is intentionally parser-light: Task 22 compiles crawl/extract outputs, while
 * richer raw Markdown/RST/source parsing belongs to Task 21 and symbol filtering to Task 23.
 */
import * as cssSelect from "css-select";
import type { AnyNode, Element } from "domhandler";
import * as domutils from "domutils";
import { parseDocument } from "htmlparser2";
import type { ScrapeResult } from "../scrape/pipeline.js";
import {
	cleanText,
	followingSectionNodes,
	stripUndefined,
	titleCase,
} from "./_html.js";

export interface ApiSurfaceParameter {
	name: string;
	type?: string;
	description?: string;
}

export interface ApiSurfaceFunction {
	name: string;
	signature?: string;
	description?: string;
	parameters?: ApiSurfaceParameter[];
	returns?: { type?: string; description?: string };
	examples?: string[];
	url?: string;
}

export interface ApiSurfaceClass {
	name: string;
	description?: string;
	methods?: ApiSurfaceFunction[];
	url?: string;
}

export interface ApiSurfaceModule {
	name: string;
	description?: string;
	url: string;
	functions: ApiSurfaceFunction[];
	classes?: ApiSurfaceClass[];
	errors?: Array<{ code: string; message: string; url?: string }>;
}

export interface ApiSurfaceTree {
	project?: string;
	version?: string;
	modules: ApiSurfaceModule[];
	errors?: Array<{ code: string; message: string; url?: string }>;
	fallback?: { kind: "flat-markdown"; reason: string; pageCount: number };
}

export interface ApiSurfaceInputPage {
	url: string;
	finalUrl?: string;
	title?: string;
	description?: string;
	html?: string;
	markdown?: string;
	text?: string;
	data?: unknown;
	error?: { code: string; message: string };
}

export function buildApiSurfaceFromScrapes(
	pages: ScrapeResult[],
): ApiSurfaceTree {
	return buildApiSurface(
		pages.map((page) => ({
			url: page.url ?? page.finalUrl ?? "unknown",
			finalUrl: page.finalUrl,
			title: page.data.title,
			description: page.data.description,
			html: page.data.html,
			markdown: page.data.markdown,
			text: page.data.text,
			data: page.data.json,
			error: page.error && {
				code: page.error.code,
				message: page.error.message,
			},
		})),
	);
}

export function buildApiSurface(pages: ApiSurfaceInputPage[]): ApiSurfaceTree {
	const modules: ApiSurfaceModule[] = [];
	const errors: ApiSurfaceTree["errors"] = [];
	for (const page of pages) {
		if (page.error) {
			errors.push({ ...page.error, url: page.finalUrl ?? page.url });
			continue;
		}
		modules.push(moduleFromPage(page));
	}
	const tree: ApiSurfaceTree = stripUndefined({
		project: inferProject(pages),
		version: firstVersion(modules, pages),
		modules,
		errors: errors.length ? errors : undefined,
		fallback: modules.some(hasApiSymbols)
			? undefined
			: {
					kind: "flat-markdown",
					reason:
						"No API signatures were detected; returned page-level documentation modules.",
					pageCount: modules.length,
				},
	});
	return tree;
}

function moduleFromPage(page: ApiSurfaceInputPage): ApiSurfaceModule {
	const url = page.finalUrl ?? page.url;
	const docsite = docsiteData(page.data);
	if (docsite) return moduleFromDocsite(page, docsite, url);
	const parsed = parsePageContent(page, url);
	return stripUndefined({
		name: page.title ?? parsed.title ?? moduleNameFromUrl(url),
		description: page.description ?? parsed.description,
		url,
		functions: parsed.functions,
		classes: parsed.classes.length ? parsed.classes : undefined,
	});
}

function moduleFromDocsite(
	page: ApiSurfaceInputPage,
	docsite: DocsiteLike,
	url: string,
): ApiSurfaceModule {
	const functions = docsite.apiSignature
		? [signatureFunction(docsite.apiSignature, url)]
		: functionsFromSections(docsite.sections ?? [], url);
	const classes = classesFromSections(docsite.sections ?? [], url);
	return stripUndefined({
		name: docsite.title ?? page.title ?? moduleNameFromUrl(url),
		description: docsite.summary ?? page.description,
		url,
		functions,
		classes: classes.length ? classes : undefined,
	});
}

function parsePageContent(
	page: ApiSurfaceInputPage,
	url: string,
): {
	title?: string;
	description?: string;
	functions: ApiSurfaceFunction[];
	classes: ApiSurfaceClass[];
} {
	if (page.html) return parseHtml(page.html, url);
	return parseMarkdown(page.markdown ?? page.text ?? "", url);
}

function parseHtml(
	html: string,
	url: string,
): ReturnType<typeof parsePageContent> {
	const document = parseDocument(html, {
		lowerCaseAttributeNames: true,
		lowerCaseTags: true,
	});
	const title = firstText(document, ["main h1", "article h1", "h1", "title"]);
	const headings = cssSelect.selectAll(
		"h1,h2,h3,h4",
		document as AnyNode,
	) as AnyNode[];
	const sections = headings
		.filter((heading): heading is Element => domutils.isTag(heading))
		.map((heading) => {
			const level = Number.parseInt(heading.name.slice(1), 10);
			const nodes = followingSectionNodes(heading, level);
			return {
				heading: cleanText(domutils.textContent(heading)),
				content: cleanText(domutils.textContent(nodes)),
				codeBlocks: codeBlocks(nodes),
			};
		});
	return {
		title,
		description: firstParagraph(document),
		functions: functionsFromSections(sections, url),
		classes: classesFromSections(sections, url),
	};
}

function parseMarkdown(
	markdown: string,
	url: string,
): ReturnType<typeof parsePageContent> {
	const sections: SectionLike[] = [];
	let current: SectionLike | undefined;
	let inFence = false;
	let fenceLanguage = "";
	let fence: string[] = [];
	for (const line of markdown.split(/\r?\n/u)) {
		const fenceMatch = line.match(/^```\s*([\w+-]+)?/u);
		if (fenceMatch) {
			if (inFence && current) {
				(current.codeBlocks ??= []).push({
					language: fenceLanguage || undefined,
					code: fence.join("\n").trim(),
				});
				fence = [];
			} else {
				fenceLanguage = fenceMatch[1] ?? "";
			}
			inFence = !inFence;
			continue;
		}
		if (inFence) {
			fence.push(line);
			continue;
		}
		const heading = line.match(/^(#{1,4})\s+(.+)$/u);
		if (heading) {
			current = { heading: cleanText(heading[2]), content: "", codeBlocks: [] };
			sections.push(current);
			continue;
		}
		if (current)
			current.content = cleanText(`${current.content ?? ""} ${line}`);
	}
	return {
		title: sections[0]?.heading,
		description: sections[0]?.content,
		functions: functionsFromSections(sections, url),
		classes: classesFromSections(sections, url),
	};
}

function functionsFromSections(
	sections: SectionLike[],
	url: string,
): ApiSurfaceFunction[] {
	const functions: ApiSurfaceFunction[] = [];
	for (const section of sections) {
		const signature = signatureFromSection(section);
		const name = signature
			? nameFromSignature(signature)
			: symbolName(section.heading);
		if (!name || looksLikeClass(section.heading)) continue;
		functions.push(
			stripUndefined({
				name,
				signature,
				description: truncate(section.content, 700),
				examples: examples(section.codeBlocks),
				url: sectionUrl(url, section.anchor),
			}),
		);
	}
	return dedupeByName(functions);
}

function classesFromSections(
	sections: SectionLike[],
	url: string,
): ApiSurfaceClass[] {
	const classes: ApiSurfaceClass[] = [];
	for (const section of sections) {
		if (!looksLikeClass(section.heading)) continue;
		classes.push(
			stripUndefined({
				name: section.heading.replace(/^class\s+/iu, "").trim(),
				description: truncate(section.content, 700),
				methods: functionsFromSections([{ ...section, heading: "" }], url),
				url: sectionUrl(url, section.anchor),
			}),
		);
	}
	return dedupeByName(classes);
}

function signatureFunction(
	signature: NonNullable<DocsiteLike["apiSignature"]>,
	url: string,
): ApiSurfaceFunction {
	return stripUndefined({
		name: signature.name,
		signature: signature.signature,
		parameters: signature.parameters,
		returns: signature.returns,
		url,
	});
}

interface SectionLike {
	heading: string;
	anchor?: string;
	content?: string;
	codeBlocks?: Array<{ language?: string; code: string }>;
}

interface DocsiteLike {
	title?: string;
	summary?: string;
	version?: string;
	sections?: SectionLike[];
	apiSignature?: {
		name: string;
		signature: string;
		parameters?: ApiSurfaceParameter[];
		returns?: { type?: string; description?: string };
	};
}

function docsiteData(data: unknown): DocsiteLike | undefined {
	if (!data || typeof data !== "object") return undefined;
	const value = data as {
		title?: unknown;
		sections?: unknown;
		source?: { provider?: unknown };
	};
	return value.source?.provider === "docsite" || Array.isArray(value.sections)
		? (data as DocsiteLike)
		: undefined;
}

function signatureFromSection(section: SectionLike): string | undefined {
	return section.codeBlocks
		?.map((block) => block.code)
		.find((code) => /[A-Za-z_$][\w$]*(?:\.|#)?[\w$]*\s*\(/u.test(code));
}

function nameFromSignature(signature: string): string | undefined {
	return signature.match(
		/(?:function\s+|new\s+)?([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)\s*\(/u,
	)?.[1];
}

function symbolName(heading: string): string | undefined {
	return heading.match(
		/`?([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)\s*\(/u,
	)?.[1];
}

function looksLikeClass(heading: string): boolean {
	return /^class\s+/iu.test(heading) || /\bclass\b/iu.test(heading);
}

function examples(blocks: SectionLike["codeBlocks"]): string[] | undefined {
	const values = blocks?.map((block) => block.code).filter(Boolean) ?? [];
	return values.length ? values.slice(0, 3) : undefined;
}

function hasApiSymbols(module: ApiSurfaceModule): boolean {
	return module.functions.length > 0 || Boolean(module.classes?.length);
}

function firstVersion(
	modules: ApiSurfaceModule[],
	pages: ApiSurfaceInputPage[],
): string | undefined {
	for (const page of pages) {
		const version =
			docsiteData(page.data)?.version ??
			versionFromUrl(page.finalUrl ?? page.url);
		if (version) return version;
	}
	return versionFromUrl(modules[0]?.url);
}

function inferProject(pages: ApiSurfaceInputPage[]): string | undefined {
	const first =
		pages.find((page) => page.url !== "unknown")?.finalUrl ?? pages[0]?.url;
	if (!first) return undefined;
	try {
		const url = new URL(first);
		return url.hostname.replace(/^www\./u, "");
	} catch {
		return undefined;
	}
}

function versionFromUrl(value?: string): string | undefined {
	if (!value) return undefined;
	try {
		return new URL(value).pathname
			.split("/")
			.find((part) =>
				/^(?:v?\d+(?:\.\d+){0,3}|latest|next|stable)$/iu.test(part),
			);
	} catch {
		return undefined;
	}
}

function moduleNameFromUrl(value: string): string {
	try {
		const url = new URL(value);
		return titleCase(
			url.pathname.split("/").filter(Boolean).at(-1) ?? url.hostname,
		);
	} catch {
		return value;
	}
}

function firstText(document: AnyNode, selectors: string[]): string | undefined {
	for (const selector of selectors) {
		const text = cleanText(
			domutils.textContent(cssSelect.selectOne(selector, document) ?? []),
		);
		if (text) return text;
	}
	return undefined;
}

function firstParagraph(document: AnyNode): string | undefined {
	return truncate(
		cleanText(
			domutils.textContent(
				cssSelect.selectOne("main p, article p, p", document) ?? [],
			),
		),
		700,
	);
}

function codeBlocks(
	nodes: AnyNode[],
): Array<{ language?: string; code: string }> {
	return cssSelect
		.selectAll("pre", nodes)
		.map((node) => cleanText(domutils.textContent(node)))
		.filter(Boolean)
		.map((code) => ({ code }));
}

function sectionUrl(url: string, anchor?: string): string {
	return anchor ? `${url}${anchor}` : url;
}

function dedupeByName<T extends { name: string }>(items: T[]): T[] {
	const seen = new Set<string>();
	return items.filter((item) => {
		const key = item.name.toLowerCase();
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function truncate(value: string | undefined, max: number): string | undefined {
	if (!value) return undefined;
	return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
