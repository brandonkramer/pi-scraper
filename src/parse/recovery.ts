import type { DomAdapter } from "./dom-adapter.js";
import { absoluteUrl } from "./selectors.js";

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
	return dedupe(recovered);
}

function dedupe(items: RecoveredContent[]): RecoveredContent[] {
	const seen = new Set<string>();
	return items.filter((item) => {
		const key = `${item.kind}:${item.text}:${item.url ?? ""}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function clean(value: string): string {
	return value.replace(/\s+/gu, " ").trim();
}
