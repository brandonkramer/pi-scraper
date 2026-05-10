/**
 * @fileoverview parse recovery module.
 */
import { dedupeBy } from "../../url/dedupe.ts";
import type { DomAdapter } from "../dom/adapter.ts";
import { absoluteUrl } from "../dom/selectors.ts";

export interface RecoveredContent {
	kind: "heading" | "hero" | "announcement" | "footer_link";
	text: string;
	url?: string;
}

export function recoverUsefulContent(
	dom: DomAdapter,
	baseUrl: string,
): RecoveredContent[] {
	const recovered: RecoveredContent[] = [];
	for (const node of dom.nodes(
		dom.select(
			"h1,h2,[class*=hero],[id*=hero],[class*=announcement],[role=banner]",
		),
	)) {
		const text = clean(dom.text(node));
		if (!text) continue;
		const tag = dom.tagName(node) ?? "";
		const kind = /^h[12]$/iu.test(tag)
			? "heading"
			: text.toLowerCase().includes("announce")
				? "announcement"
				: "hero";
		recovered.push({ kind, text });
	}
	for (const node of dom.nodes(
		dom.select('footer a[href],nav[aria-label*="footer" i] a[href]'),
	)) {
		const text = clean(dom.text(node));
		const url = absoluteUrl(dom.attr(node, "href"), baseUrl);
		if (text && url) recovered.push({ kind: "footer_link", text, url });
	}
	return dedupeBy(
		recovered,
		(item) => `${item.kind}:${item.text}:${item.url ?? ""}`,
	);
}

function clean(value: string): string {
	return value.replace(/\s+/gu, " ").trim();
}
