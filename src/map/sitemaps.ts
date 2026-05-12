/** @file Map sitemaps module — sitemap.xml parsing and robots.txt sitemap discovery. */
import { gunzipSync } from "node:zlib";

import { normalizeUrl } from "../url/normalize.ts";

export interface SitemapUrlEntry {
	url: string;
	lastmod?: string;
	source: string;
}

export interface SitemapParseResult {
	urls: SitemapUrlEntry[];
	sitemaps: string[];
}

export function parseSitemapXml(xml: string | Buffer, source: string): SitemapParseResult {
	const text = Buffer.isBuffer(xml) ? decodeMaybeGzip(xml, source) : xml;
	const urls = [...text.matchAll(/<url>\s*([\s\S]*?)\s*<\/url>/giu)]
		.map((match) => {
			const block = match[1] || "";
			const loc = tagText(block, "loc");
			return loc
				? { url: normalizeUrl(loc), lastmod: tagText(block, "lastmod"), source }
				: undefined;
		})
		.filter(Boolean) as SitemapUrlEntry[];
	const sitemaps = [...text.matchAll(/<sitemap>\s*([\s\S]*?)\s*<\/sitemap>/giu)]
		.map((match) => tagText(match[1] || "", "loc"))
		.filter(Boolean)
		.map((loc) => normalizeUrl(loc!));
	return { urls, sitemaps };
}

export function defaultSitemapUrl(seedUrl: string): string {
	const parsed = new URL(seedUrl);
	return `${parsed.protocol}//${parsed.host}/sitemap.xml`;
}

const tagTextRegexCache = new Map<string, RegExp>();

function tagText(block: string, tag: string): string | undefined {
	let regex = tagTextRegexCache.get(tag);
	if (!regex) {
		const escaped = tag.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");
		// oxlint-disable-next-line security/detect-non-literal-regexp -- tag is a hardcoded element name, not user input
		regex = new RegExp(`<${escaped}[^>]*>([\\s\\S]*?)<\\/${escaped}>`, "iu");
		tagTextRegexCache.set(tag, regex);
	}
	const match = regex.exec(block);
	return match?.[1]?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/u, "$1").trim();
}

function decodeMaybeGzip(buffer: Buffer, source: string): string {
	return source.endsWith(".gz") ? gunzipSync(buffer).toString("utf8") : buffer.toString("utf8");
}

export function robotsUrlForSite(seedUrl: string): string {
	const parsed = new URL(seedUrl);
	return `${parsed.protocol}//${parsed.host}/robots.txt`;
}

export function parseRobotsSitemaps(
	body: string,
	robotsUrl: string,
): { robotsUrl: string; sitemaps: string[] } {
	const base = new URL(robotsUrl);
	const sitemaps = body
		.split(/\r?\n/u)
		.map((line) => line.match(/^\s*sitemap\s*:\s*(.+?)\s*$/iu)?.[1])
		.filter(Boolean)
		.map((value) => normalizeUrl(new URL(value!, base).toString()));
	return { robotsUrl, sitemaps: [...new Set(sitemaps)] };
}
