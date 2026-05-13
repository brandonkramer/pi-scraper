/* @fileoverview Alternate content-format matching and safe one-hop follow heuristics. */
import type { AlternateLink } from "../parse/discovery/alternates.ts";
import type { CommonScrapeOptions, OutputFormat } from "../types.ts";

export type AlternateOutputFormat = OutputFormat | "llm-text";

export const FORMAT_TO_MIME = {
	markdown: ["text/markdown", "text/x-markdown", "text/plain;variant=markdown"],
	json: ["application/json", "application/ld+json", "text/json"],
	text: ["text/plain"],
	html: ["text/html", "application/xhtml+xml"],
	llm: ["text/markdown", "text/plain"],
	"llm-text": ["text/markdown", "text/plain"],
	raw: [],
} as const satisfies Record<AlternateOutputFormat, readonly string[]>;

export type AlternateFollowOptions = CommonScrapeOptions;

interface AlternateResultLike {
	url?: string;
	finalUrl?: string;
	data: {
		route?: string;
		markdown?: string;
		text?: string;
		html?: string;
	};
}

const DEFAULT_THIN_CONTENT_CHARS = 100;

export function pickAlternateForFormat(
	alternates: readonly AlternateLink[],
	format: AlternateOutputFormat,
): AlternateLink | undefined {
	const targets = FORMAT_TO_MIME[format];
	return (
		findMatchingAlternate(alternates, targets, "exact") ??
		findMatchingAlternate(alternates, targets, "prefix")
	);
}

export function shouldFollowAlternate(
	candidate: AlternateLink,
	originalResult: AlternateResultLike,
	options: AlternateFollowOptions = {},
): boolean {
	if (options.alternateFor) return false;
	const currentUrl = originalResult.finalUrl ?? originalResult.url;
	if (!currentUrl) return false;
	if (!isSameOrigin(candidate.url, currentUrl)) return false;
	if (sameUrl(candidate.url, currentUrl)) return false;
	if (options.preferAlternates) return true;
	if (originalResult.data.route !== "html") return false;
	return (
		meaningfulContentLength(originalResult) <
		(options.alternateThinContentChars ?? DEFAULT_THIN_CONTENT_CHARS)
	);
}

function findMatchingAlternate(
	alternates: readonly AlternateLink[],
	targets: readonly string[],
	mode: "exact" | "prefix",
): AlternateLink | undefined {
	for (const target of targets) {
		for (const alternate of alternates) {
			if (mediaTypeMatches(alternate.type, target, mode)) return alternate;
		}
	}
}

function mediaTypeMatches(
	candidateType: string | undefined,
	targetType: string,
	mode: "exact" | "prefix",
): boolean {
	if (!candidateType) return false;
	const candidate = normalizeMediaType(candidateType);
	const target = normalizeMediaType(targetType);
	if (mode === "exact") {
		return (
			candidate.full === target.full ||
			(candidate.params.length === 0 && candidate.base === target.base)
		);
	}
	return candidate.full.startsWith(`${target.full};`) || candidate.base.startsWith(target.base);
}

function normalizeMediaType(value: string): { full: string; base: string; params: string[] } {
	const parts = value
		.toLowerCase()
		.split(";")
		.map((part) => part.trim())
		.filter(Boolean);
	return { full: parts.join(";"), base: parts[0] ?? "", params: parts.slice(1) };
}

function isSameOrigin(candidateUrl: string, currentUrl: string): boolean {
	try {
		return new URL(candidateUrl).origin === new URL(currentUrl).origin;
	} catch {
		return false;
	}
}

function sameUrl(candidateUrl: string, currentUrl: string): boolean {
	try {
		const candidate = new URL(candidateUrl);
		const current = new URL(currentUrl);
		candidate.hash = "";
		current.hash = "";
		return candidate.toString() === current.toString();
	} catch {
		return false;
	}
}

function meaningfulContentLength(result: AlternateResultLike): number {
	const content = result.data.markdown ?? result.data.text ?? result.data.html ?? "";
	return content.replaceAll(/\s+/gu, " ").trim().length;
}
