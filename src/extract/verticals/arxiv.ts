/**
 * @fileoverview extract verticals arxiv module.
 */
import { cleanText as sharedCleanText } from "../_html.js";
import { capability, type VerticalExtractor } from "../capabilities.js";

export const arxivExtractor: VerticalExtractor = {
	capability: capability(
		"arxiv",
		["https://arxiv.org/abs/:id", "https://arxiv.org/pdf/:id"],
		{
			type: "object",
			required: ["id", "title"],
			properties: {
				id: { type: "string" },
				title: { type: "string" },
				summary: { type: "string" },
				published: { type: "string" },
			},
		},
	),
	match: (url) => {
		if (url.hostname !== "arxiv.org") return undefined;
		const [kind, rawId, ...rest] = url.pathname.split("/").filter(Boolean);
		if ((kind !== "abs" && kind !== "pdf") || !rawId || rest.length > 0)
			return undefined;
		return { id: rawId.replace(/\.pdf$/iu, "") };
	},
	extract: async (_url, match, context, signal) => {
		if (!context.fetchText)
			throw new Error("arxiv extractor requires fetchText support");
		const xml = await context.fetchText(
			`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(match.id)}`,
			signal,
		);
		const entry = firstTag(xml, "entry");
		if (!entry) throw new Error(`arXiv entry not found for ${match.id}`);
		return {
			id: extractArxivId(firstTag(entry, "id")) ?? match.id,
			title: arxivText(firstTag(entry, "title")),
			summary: arxivText(firstTag(entry, "summary")),
			published: arxivText(firstTag(entry, "published")),
			updated: arxivText(firstTag(entry, "updated")),
			authors: allTags(entry, "name").map(arxivText).filter(isPresent),
			categories: allCategoryTerms(entry),
			pdfUrl: firstPdfLink(entry),
		};
	},
};

function firstTag(xml: string, name: string): string | undefined {
	return new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "iu").exec(
		xml,
	)?.[1];
}

function allTags(xml: string, name: string): string[] {
	return [
		...xml.matchAll(
			new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "giu"),
		),
	].map((match) => match[1] ?? "");
}

function allCategoryTerms(xml: string): string[] {
	return [...xml.matchAll(/<category\b[^>]*\bterm="([^"]+)"[^>]*>/giu)].map(
		(match) => decodeXml(match[1] ?? ""),
	);
}

function firstPdfLink(xml: string): string | undefined {
	return [...xml.matchAll(/<link\b([^>]+)>/giu)]
		.map((match) => match[1] ?? "")
		.find((attrs) => /title="pdf"/iu.test(attrs))
		?.match(/href="([^"]+)"/iu)?.[1];
}

function extractArxivId(idUrl: string | undefined): string | undefined {
	const text = arxivText(idUrl);
	return text ? text.split("/abs/").pop() : undefined;
}

function arxivText(value: string | undefined): string | undefined {
	const decoded = decodeXml(value ?? "");
	const cleaned = sharedCleanText(decoded);
	return cleaned || undefined;
}

function isPresent<T>(value: T | undefined): value is T {
	return value !== undefined;
}

function decodeXml(value: string): string {
	return value
		.replace(/&quot;/gu, '"')
		.replace(/&apos;/gu, "'")
		.replace(/&lt;/gu, "<")
		.replace(/&gt;/gu, ">")
		.replace(/&amp;/gu, "&");
}
