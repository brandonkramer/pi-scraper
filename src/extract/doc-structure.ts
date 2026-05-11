/** @file Shared document-section extraction for docs and API surfaces. */
import { selectAll, selectOne } from "css-select";
import type { AnyNode, Element } from "domhandler";
import { getAttributeValue, isTag, textContent } from "domutils";

import { cleanText, stripUndefined, truncateText } from "./text.ts";

export interface ExtractedCodeBlock {
	language?: string;
	code: string;
}

export interface ExtractedDocSection {
	heading: string;
	level: number;
	anchor?: string;
	content?: string;
	codeBlocks?: ExtractedCodeBlock[];
}

export function extractHeadingSections(
	root: AnyNode,
	options: { contentChars?: number } = {},
): ExtractedDocSection[] {
	return selectAll("h1,h2,h3,h4,h5,h6", root)
		.filter((heading): heading is Element => isTag(heading))
		.map((heading) => sectionFromHeading(heading, options))
		.filter((section) => section.heading);
}

export function sectionFromHeading(
	heading: Element,
	options: { contentChars?: number } = {},
): ExtractedDocSection {
	const level = headingLevel(heading);
	const contentNodes = followingSectionNodes(heading, level);
	const codeBlocks = extractCodeBlocks(contentNodes);
	return stripUndefined({
		heading: cleanText(textContent(heading)),
		level,
		anchor: headingAnchor(heading),
		content: sectionContent(contentNodes, options.contentChars),
		codeBlocks: codeBlocks.length > 0 ? codeBlocks : undefined,
	});
}

export function extractCodeBlocks(nodes: AnyNode[]): ExtractedCodeBlock[] {
	return selectAll("pre", nodes)
		.filter((node): node is Element => isTag(node))
		.map((node) => {
			const code = selectOne("code", node);
			const className =
				code && isTag(code) ? getAttributeValue(code, "class") : getAttributeValue(node, "class");
			return stripUndefined({
				language: extractLanguage(className),
				code: cleanText(textContent(code ?? node)),
			});
		})
		.filter((block) => block.code);
}

export function firstTextBySelector(document: AnyNode, selectors: string[]): string | undefined {
	for (const selector of selectors) {
		const node = selectOne(selector, document);
		const text = cleanText(node ? textContent(node) : "");
		if (text) return text;
	}
}

export function headingAnchor(node: Element): string | undefined {
	const id = getAttributeValue(node, "id");
	if (id) return `#${id}`;
	const link = selectOne("a[href^='#']", node);
	return link && isTag(link) ? getAttributeValue(link, "href") : undefined;
}

export function headingLevel(node: Element): number {
	return Number.parseInt(node.name.slice(1), 10);
}

function sectionContent(
	contentNodes: AnyNode[],
	contentChars: number | undefined,
): string | undefined {
	const text = cleanText(textContent(contentNodes));
	return contentChars === undefined ? text : truncateText(text, contentChars);
}

function extractLanguage(className?: string): string | undefined {
	return className?.match(/(?:language|lang)-([A-Za-z0-9_+-]+)/u)?.[1];
}

function followingSectionNodes(heading: AnyNode, level: number): AnyNode[] {
	const nodes: AnyNode[] = [];
	let next = (heading as { next?: AnyNode }).next;
	while (next) {
		if (isTag(next) && /^h[1-6]$/u.test(next.name)) {
			const nextLevel = Number.parseInt(next.name.slice(1), 10);
			if (nextLevel <= level) break;
		}
		nodes.push(next);
		next = (next as { next?: AnyNode }).next;
	}
	return nodes;
}
