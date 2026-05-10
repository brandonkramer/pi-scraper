/** @fileoverview Stable text serializers for code-adjacent parsed documentation. */

import {
	docstringsToMarkdown,
	type ParsedDocstrings,
} from "../parse/docstrings.ts";
import type { MarkupDocument } from "../parse/markup-doc.ts";

export function markupDocumentToMarkdown(document: MarkupDocument): string {
	return document.markdown || document.text;
}

export function markupDocumentToText(document: MarkupDocument): string {
	const parts = [
		document.frontmatter ? frontmatterText(document.frontmatter) : undefined,
		document.text,
		document.codeBlocks.length
			? `${document.codeBlocks.length} code block(s): ${document.codeBlocks
					.map((block) => block.language)
					.filter(Boolean)
					.join(", ")}`
			: undefined,
	]
		.filter(Boolean)
		.join("\n\n");
	return parts.trim();
}

export function docstringsToText(document: ParsedDocstrings): string {
	return docstringsToMarkdown(document);
}

function frontmatterText(frontmatter: Record<string, unknown>): string {
	return Object.entries(frontmatter)
		.map(
			([key, value]) =>
				`${key}: ${Array.isArray(value) ? value.join(", ") : String(value)}`,
		)
		.join("\n");
}
