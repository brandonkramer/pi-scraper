import type { DomAdapter } from "../parse/dom-adapter.js";
import { absoluteUrl } from "../parse/selectors.js";

export interface BrandAsset {
	url: string;
	kind: "logo" | "icon" | "image" | "manifest";
	rel?: string;
	alt?: string;
	type?: string;
	source: string;
}

export function extractBrandAssets(
	dom: DomAdapter,
	baseUrl: string,
): BrandAsset[] {
	const assets: BrandAsset[] = [];
	for (const node of dom.nodes(dom.select("link[href]"))) {
		const rel = dom.attr(node, "rel")?.toLowerCase() ?? "";
		const href = absoluteUrl(dom.attr(node, "href"), baseUrl);
		if (!href) continue;
		if (rel.includes("icon") || rel.includes("apple-touch-icon")) {
			assets.push({
				url: href,
				kind: "icon",
				rel,
				type: dom.attr(node, "type"),
				source: "link",
			});
		} else if (rel.includes("manifest")) {
			assets.push({
				url: href,
				kind: "manifest",
				rel,
				type: dom.attr(node, "type"),
				source: "link",
			});
		}
	}

	for (const node of dom.nodes(
		dom.select('meta[property="og:image"],meta[name="twitter:image"]'),
	)) {
		const url = absoluteUrl(dom.attr(node, "content"), baseUrl);
		if (url) {
			assets.push({
				url,
				kind: "image",
				source: dom.attr(node, "property") ?? dom.attr(node, "name") ?? "meta",
			});
		}
	}

	for (const node of dom.nodes(dom.select("img[src]"))) {
		const src = dom.attr(node, "src") ?? "";
		const alt = dom.attr(node, "alt") ?? "";
		const className = dom.attr(node, "class") ?? "";
		const id = dom.attr(node, "id") ?? "";
		if (!/logo|brand|mark/iu.test(`${src} ${alt} ${className} ${id}`)) {
			continue;
		}
		const url = absoluteUrl(src, baseUrl);
		if (url) assets.push({ url, kind: "logo", alt, source: "img" });
	}
	return dedupeAssets(assets);
}

function dedupeAssets(assets: BrandAsset[]): BrandAsset[] {
	const seen = new Set<string>();
	return assets.filter((asset) => {
		const key = `${asset.kind}:${asset.url}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}
