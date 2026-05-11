/** @file Map llms module. */
import { dedupeBy } from "../url/dedupe.ts";
import { normalizeUrl } from "../url/normalize.ts";

export interface LlmsLinkEntry {
	url: string;
	title?: string;
	source: string;
}

export function llmsUrlForSite(seedUrl: string): string {
	const parsed = new URL(seedUrl);
	return `${parsed.protocol}//${parsed.host}/llms.txt`;
}

export function parseLlmsLinks(markdown: string, llmsUrl: string): LlmsLinkEntry[] {
	const base = new URL(llmsUrl);
	const links: LlmsLinkEntry[] = [];
	for (const match of markdown.matchAll(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu)) {
		links.push({
			title: match[1],
			url: normalizeUrl(new URL(match[2], base).toString()),
			source: llmsUrl,
		});
	}
	for (const match of markdown.matchAll(/(^|\s)(https?:\/\/[^\s)]+)/giu)) {
		links.push({ url: normalizeUrl(match[2]), source: llmsUrl });
	}
	return dedupeBy(links, (entry) => entry.url);
}
