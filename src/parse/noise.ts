import type { Cheerio, CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";
import { visibleText } from "./selectors.js";

export interface MainContentCandidate {
	selector: string;
	textLength: number;
	linkDensity: number;
	score: number;
}

const MAIN_SELECTORS = [
	"main",
	"article",
	'[role="main"]',
	".content",
	".main-content",
	"#content",
	"#main",
	"body",
] as const;

export function mainContentRoot(
	$: CheerioAPI,
	candidates = rankMainCandidates($),
): Cheerio<AnyNode> {
	const selector = candidates[0]?.selector ?? "body";
	return $(selector).first();
}

export function rankMainCandidates($: CheerioAPI): MainContentCandidate[] {
	return MAIN_SELECTORS.flatMap((selector) =>
		$(selector)
			.toArray()
			.map((node, index) => scoreCandidate($, $(node), selector, index)),
	)
		.filter((candidate) => candidate.textLength > 0)
		.sort((left, right) => right.score - left.score);
}

export function linkDensity(
	$: CheerioAPI,
	root: Cheerio<AnyNode>,
	textLength = visibleText($, root).length,
): number {
	if (textLength === 0) return 0;
	const linkTextLength = root
		.find("a")
		.toArray()
		.reduce((sum, node) => sum + visibleText($, $(node)).length, 0);
	return Math.min(1, linkTextLength / textLength);
}

function scoreCandidate(
	$: CheerioAPI,
	root: Cheerio<AnyNode>,
	selector: string,
	index: number,
): MainContentCandidate {
	const textLength = visibleText($, root).length;
	const density = linkDensity($, root, textLength);
	const semanticBoost = ["main", "article", '[role="main"]'].includes(selector)
		? 500
		: 0;
	return {
		selector: index === 0 ? selector : `${selector}:eq(${index})`,
		textLength,
		linkDensity: density,
		score: textLength * (1 - density) + semanticBoost,
	};
}
