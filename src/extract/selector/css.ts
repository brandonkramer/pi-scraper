/**
 * @remarks
 *   Takes the matched elements from the adaptive selector and converts them into structured output
 *   (text, html, markdown, or a specific attribute).
 * @file Extraction workflow for selector-based adaptive extraction.
 */
import renderDom from "dom-serializer";
import type { Element } from "domhandler";
import { textContent } from "domutils";

import type { AdaptiveSelectorResult } from "../../parse/adaptive/selector.ts";
import type {
	SelectorExtractionOptions,
	SelectorExtractionMatch,
	SelectorExtractionResult,
} from "./types.ts";

export type {
	SelectorExtractionOptions,
	SelectorExtractionMatch,
	SelectorExtractionResult,
} from "./types.ts";

/** Convert adaptive selector results into structured extraction output. */
export function extractFromSelectorResult(
	selectorResult: AdaptiveSelectorResult,
	options: SelectorExtractionOptions,
): SelectorExtractionResult {
	const matches = selectorResult.elements.map((el) => extractElement(el, options));
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
			const content = textContent(element).trim();
			return { content, tag, attributes };
		}
		case "html": {
			const content = renderDom(element);
			return { content, tag, attributes };
		}
		case "markdown": {
			// Best-effort: extract text with tag labels as hints
			const content = textContent(element).trim();
			return { content, tag, attributes };
		}
		case "attribute": {
			const attr = options.attribute ?? "href";
			const content = element.attribs[attr] ?? "";
			return { content, tag, attributes };
		}
		default: {
			const content = textContent(element).trim();
			return { content, tag, attributes };
		}
	}
}
