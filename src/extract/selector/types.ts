/**
 * @fileoverview Selector extraction types.
 */
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
