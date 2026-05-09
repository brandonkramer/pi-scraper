/**
 * @fileoverview Extraction workflow for selector-based adaptive extraction.
 *
 * @remarks
 * Takes the matched elements from the adaptive selector and converts them
 * into structured output (text, html, markdown, or a specific attribute).
 */
import type { Element } from "domhandler";
import * as domutils from "domutils";
import renderDom from "dom-serializer";
import type { AdaptiveSelectorResult } from "../parse/adaptive-selector.js";

export interface SelectorExtractionOptions {
	/** Output shape. */
	format: "text" | "html" | "markdown" | "attribute";

	/** Attribute name when format === "attribute". */
	attribute?: string;
}

export interface SelectorExtractionMatch {
	/** Extracted content per element. */
	content: string;

	/** Element tag name. */
	tag?: string;

	/** Element attributes when relevant. */
	attributes?: Record<string, string>;
}

export interface SelectorExtractionResult {
	/** Strategy that produced the match. */
	strategy: "direct" | "adaptive" | "none";

	/** Number of elements that matched directly. */
	directMatches: number;

	/** Number of adaptive candidates found. */
	adaptiveMatches: number;

	/** Best similarity score for adaptive strategy. */
	score?: number;

	/** Whether a fingerprint was saved. */
	saved: boolean;

	/** Extracted matches. */
	matches: SelectorExtractionMatch[];

	/** Combined text for LLM consumption. */
	text: string;
}

/**
 * Convert adaptive selector results into structured extraction output.
 */
export function extractFromSelectorResult(
	selectorResult: AdaptiveSelectorResult,
	options: SelectorExtractionOptions,
): SelectorExtractionResult {
	const matches = selectorResult.elements.map((el) =>
		extractElement(el, options),
	);
	const text = matches.map((m) => m.content).join("\n\n");

	return {
		strategy: selectorResult.strategy,
		directMatches: selectorResult.directMatches,
		adaptiveMatches: selectorResult.adaptiveMatches,
		score: selectorResult.score,
		saved: selectorResult.saved,
		matches,
		text,
	};
}

function extractElement(
	element: Element,
	options: SelectorExtractionOptions,
): SelectorExtractionMatch {
	const tag = element.name;
	const attributes = { ...element.attribs };

	switch (options.format) {
		case "text": {
			const content = domutils.textContent(element).trim();
			return { content, tag, attributes };
		}
		case "html": {
			const content = renderDom(element);
			return { content, tag, attributes };
		}
		case "markdown": {
			// Best-effort: extract text with tag labels as hints
			const content = domutils.textContent(element).trim();
			return { content, tag, attributes };
		}
		case "attribute": {
			const attr = options.attribute ?? "href";
			const content = element.attribs[attr] ?? "";
			return { content, tag, attributes };
		}
		default: {
			const content = domutils.textContent(element).trim();
			return { content, tag, attributes };
		}
	}
}
