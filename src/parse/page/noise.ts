/** @file Parse noise module. */
import type { DomAdapter, DomNode, DomSelection } from "../dom/adapter.ts";
import { visibleText } from "../dom/selectors.ts";

export interface MainContentCandidate {
	selector: string;
	textLength: number;
	linkDensity: number;
	score: number;
}

interface ScoredMainContentCandidate extends MainContentCandidate {
	node: DomNode;
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

const candidateNodes = new WeakMap<MainContentCandidate, DomNode>();

export function mainContentRoot(
	dom: DomAdapter,
	candidates = rankMainCandidates(dom),
): DomSelection {
	const node = candidates[0] ? candidateNodes.get(candidates[0]) : undefined;
	if (node) return dom.selection([node]);
	return dom.first(dom.select("body"));
}

export function rankMainCandidates(dom: DomAdapter): MainContentCandidate[] {
	return MAIN_SELECTORS.flatMap((selector) => {
		const nodes = dom.nodes(dom.select(selector));
		return nodes.map((node, index) =>
			scoreCandidate(dom, dom.selection([node]), node, selector, index),
		);
	})
		.filter((candidate) => candidate.textLength > 0)
		.toSorted((left, right) => right.score - left.score)
		.map((candidate) => {
			const { node, ...publicCandidate } = candidate;
			candidateNodes.set(publicCandidate, node);
			return publicCandidate;
		});
}

export function linkDensity(
	dom: DomAdapter,
	root: DomSelection,
	textLength = visibleText(dom, root).length,
): number {
	if (textLength === 0) return 0;
	const linkTextLength = dom
		.nodes(dom.select("a", root))
		.reduce<number>((sum, node) => sum + visibleText(dom, dom.selection([node])).length, 0);
	return Math.min(1, linkTextLength / textLength);
}

function scoreCandidate(
	dom: DomAdapter,
	root: DomSelection,
	node: DomNode,
	selector: string,
	index: number,
): ScoredMainContentCandidate {
	const textLength = visibleText(dom, root).length;
	const density = linkDensity(dom, root, textLength);
	const semanticBoost = ["main", "article", '[role="main"]'].includes(selector) ? 500 : 0;
	return {
		node,
		selector: index === 0 ? selector : `${selector}:eq(${index})`,
		textLength,
		linkDensity: density,
		score: textLength * (1 - density) + semanticBoost,
	};
}
