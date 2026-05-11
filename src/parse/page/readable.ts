/** @file Parse readable module. */
import { Readability, isProbablyReaderable } from "@mozilla/readability";
import { parseHTML } from "linkedom";

import { normalizeWhitespace } from "../../serialize/text.ts";

export interface ReadableExtraction {
	ok: boolean;
	reason?: "unavailable" | "unsuitable" | "failed";
	title?: string;
	excerpt?: string;
	byline?: string;
	siteName?: string;
	textContent?: string;
	contentHtml?: string;
	length?: number;
}

export function extractReadable(html: string, _url: string): ReadableExtraction {
	try {
		const { document } = parseHTML(html);
		// oxlint-disable-next-line typescript/no-unnecessary-condition -- capture group/optional field may be undefined at runtime
		const h1Text = (document.querySelector("h1")?.textContent ?? "").trim();
		const fallbackTitle =
			h1Text.length > 0 ? h1Text : (document.querySelector("title")?.textContent ?? "").trim();
		const clone = document.cloneNode(true) as Document;
		if (!isProbablyReaderable(clone)) {
			return { ok: false, reason: "unsuitable" };
		}
		const article = new Readability(clone).parse();
		if (!article?.textContent) {
			return { ok: false, reason: "failed" };
		}
		return {
			ok: true,
			title:
				article.title && article.title.length > 0
					? article.title
					: fallbackTitle.length > 0
						? fallbackTitle
						: undefined,
			excerpt: article.excerpt ?? undefined,
			byline: article.byline ?? undefined,
			siteName: article.siteName ?? undefined,
			textContent: normalizeWhitespace(article.textContent),
			contentHtml: article.content ?? undefined,
			length: article.length ?? undefined,
		};
	} catch (error) {
		return {
			ok: false,
			reason: "failed",
			excerpt: error instanceof Error ? error.message : undefined,
		};
	}
}
