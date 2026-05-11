/** @file Parse selectors module. */
import { normalizeWhitespace } from "../../serialize/text.ts";
import type { DomAdapter, DomSelection } from "../dom/adapter.ts";

export interface SelectorOptions {
	include?: string[];
	exclude?: string[];
	removeImages?: boolean;
}

export function prepareDocument(dom: DomAdapter, options: SelectorOptions = {}): void {
	// Split into simpler selectors for faster parsing
	dom.remove("script,style,noscript,template");
	dom.remove("iframe,canvas,svg,math,video,audio,embed,object,param,track");
	if (options.removeImages) dom.remove("img,picture,source");
	for (const selector of options.exclude ?? []) dom.remove(selector);
}

export function selectedRoots(dom: DomAdapter, options: SelectorOptions = {}): DomSelection {
	const include = options.include?.filter(Boolean) ?? [];
	if (include.length > 0) {
		return dom.selection([
			...new Set(include.flatMap((selector) => dom.nodes(dom.select(selector)))),
		]);
	}
	if (dom.count(dom.select("body")) > 0) return dom.select("body");
	if (dom.count(dom.select("html")) > 0) return dom.selection([]);
	return dom.root();
}

export function visibleText(dom: DomAdapter, root: DomSelection): string {
	return normalizeWhitespace(dom.text(root));
}

export function outerHtml(dom: DomAdapter, root: DomSelection): string {
	return dom.html(root);
}

export function absoluteUrl(href: string | undefined, baseUrl: string): string | undefined {
	if (!href) return;
	try {
		return new URL(href, baseUrl).toString();
	} catch {
		/* ignore */
	}
}
