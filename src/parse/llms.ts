/**
 * @fileoverview parse llms module.
 */
import { dedupeBy } from "../url/dedupe.js";
import { normalizeUrl } from "../url/normalize.js";

export interface AgentReadableCandidate {
	url: string;
	kind: "markdown_sibling" | "llms_txt" | "llms_entry";
}

export function likelyAgentReadableUrls(
	input: string | URL,
): AgentReadableCandidate[] {
	const url = new URL(normalizeUrl(input));
	const withoutSlash = url.pathname.replace(/\/$/u, "");
	const markdown = new URL(url);
	markdown.pathname = `${withoutSlash || "/index"}.md`;
	markdown.search = "";
	markdown.hash = "";
	const llms = new URL("/llms.txt", url.origin);
	return [
		{ url: markdown.toString(), kind: "markdown_sibling" },
		{ url: llms.toString(), kind: "llms_txt" },
	];
}

export function parseLlmsTxt(
	text: string,
	baseUrl: string,
): AgentReadableCandidate[] {
	const candidates: AgentReadableCandidate[] = [];
	for (const line of text.split(/\r?\n/u)) {
		const urls = [...line.matchAll(/https?:\/\/\S+|\[[^\]]+\]\(([^)]+)\)/giu)];
		for (const match of urls) {
			const raw = match[1] ?? match[0];
			try {
				candidates.push({
					url: new URL(raw, baseUrl).toString(),
					kind: "llms_entry",
				});
			} catch {
				// Ignore malformed llms.txt entries; callers can continue with other candidates.
			}
		}
	}
	return dedupeBy(candidates, (item) => item.url);
}
