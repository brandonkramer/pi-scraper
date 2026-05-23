/**
 * @remarks
 *   When a direct selector returns no matches, this module retrieves a stored fingerprint and scans
 *   candidate elements to find the best structural match. The approach is deterministic and local —
 *   no LLM or external service.
 * @file Adaptive CSS/XPath selector with fingerprint-based relocation.
 */
import { selectAll } from "css-select";
import { ElementType } from "domelementtype";
import type { Document, Element } from "domhandler";
import { getElementsByTagType, isTag, textContent } from "domutils";

import { healSelectorMatch } from "../../extract/selector/healing.ts";
import { fingerprintElement, type ElementFingerprint } from "./fingerprint.ts";
import { compareFingerprints } from "./similarity.ts";

export interface AdaptiveSelectorOptions {
	/** CSS or XPath selector string. */
	selector: string;

	/** Selector syntax type. */
	selectorType: "css" | "xpath" | "text";

	/** Stable storage key for this selector target. */
	identifier: string;

	/** Enable adaptive fallback when direct selection fails. */
	adaptive: boolean;

	/** Save fingerprint after a successful direct match. */
	autoSave: boolean;

	/** Minimum similarity score (0–1) to accept an adaptive candidate. */
	threshold: number;

	/** Max candidates to return. */
	limit: number;
}

export interface AdaptiveSelectorResult {
	/** Matched elements as domhandler nodes. */
	elements: Element[];

	/** How the match was produced. */
	strategy: "direct" | "adaptive" | "healed" | "none";

	/** Number of direct matches (before adaptive fallback). */
	directMatches: number;

	/** Number of adaptive candidates found. */
	adaptiveMatches: number;

	/** Best candidate score when strategy === "adaptive" or "healed". */
	score?: number;

	/** Whether a fingerprint was saved during this call. */
	saved: boolean;
}

/**
 * Run an adaptive selector against a parsed document.
 *
 * @param document — parsed htmlparser2 Document
 * @param options — selector + adaptive controls
 * @param loadFingerprint — async callback to retrieve a stored fingerprint
 * @param saveFingerprint — async callback to save a fingerprint
 * @returns Matched elements with strategy metadata
 */
export async function runAdaptiveSelector(
	document: Document,
	options: AdaptiveSelectorOptions,
	loadFingerprint: (identifier: string) => Promise<ElementFingerprint | undefined>,
	saveFingerprint: (identifier: string, fingerprint: ElementFingerprint) => Promise<void>,
): Promise<AdaptiveSelectorResult> {
	const { selector, selectorType, identifier, adaptive, autoSave, threshold, limit } = options;

	// 1. Try direct selection
	const direct = selectDirect(document, selector, selectorType);
	if (direct.length > 0) {
		// Save fingerprint of the first match if autoSave is enabled
		if (autoSave) {
			const fp = fingerprintElement(direct[0]);
			await saveFingerprint(identifier, fp);
		}
		return {
			elements: direct.slice(0, limit),
			strategy: "direct",
			directMatches: direct.length,
			adaptiveMatches: 0,
			saved: autoSave,
		};
	}

	// 2. Direct miss — try adaptive relocation, then healing
	if (adaptive) {
		const stored = await loadFingerprint(identifier);

		// 2a. Fingerprint-based relocation
		if (stored) {
			const candidates = relocateByFingerprint(document, stored, threshold);
			if (candidates.length > 0) {
				const best = candidates[0];
				const elements = candidates.map((c) => c.element).slice(0, limit);
				if (autoSave) {
					await saveFingerprint(identifier, best.fingerprint);
				}
				return {
					elements,
					strategy: "adaptive",
					directMatches: 0,
					adaptiveMatches: candidates.length,
					score: best.score,
					saved: autoSave,
				};
			}
		}

		// 2b. Text-anchor healing (selector-based semantic neighbor search)
		const healed = healSelectorMatch(document, selector, threshold, stored);
		if (healed.length > 0) {
			const best = healed[0];
			const elements = healed.map((c) => c.element).slice(0, limit);
			if (autoSave && stored) {
				await saveFingerprint(
					identifier,
					best.score >= threshold ? fingerprintElement(best.element) : stored,
				);
			}
			return {
				elements,
				strategy: "healed",
				directMatches: 0,
				adaptiveMatches: healed.length,
				score: best.score,
				saved: autoSave,
			};
		}
	}

	// 4. No match at all
	return {
		elements: [],
		strategy: "none",
		directMatches: 0,
		adaptiveMatches: 0,
		saved: false,
	};
}

function selectDirect(
	document: Document,
	selector: string,
	selectorType: "css" | "xpath" | "text",
): Element[] {
	if (selectorType === "css") {
		return selectAll(selector, document.children);
	}
	if (selectorType === "xpath") {
		// htmlparser2 does not natively support XPath; convert basic cases or return empty
		// For now, XPath falls back to CSS if it starts with a simple path, else empty
		try {
			return selectAll(selector, document.children);
		} catch {
			return [];
		}
	}
	// text search: find all elements whose text contains the needle
	const needle = selector.toLowerCase();
	const all = getElementsByTagType(ElementType.Tag, document, true);
	return all
		.filter((el): el is Element => isTag(el))
		.filter((el) => {
			const text = textContent(el).toLowerCase();
			return text.includes(needle);
		});
}

interface Candidate {
	element: Element;
	fingerprint: ElementFingerprint;
	score: number;
}

function relocateByFingerprint(
	document: Document,
	stored: ElementFingerprint,
	threshold: number,
): Candidate[] {
	const all = getElementsByTagType(ElementType.Tag, document, true).filter((el): el is Element =>
		isTag(el),
	);
	const candidates: Candidate[] = [];

	for (const element of all) {
		const fp = fingerprintElement(element);
		const result = compareFingerprints(stored, fp);
		if (result.score >= threshold) {
			candidates.push({ element, fingerprint: fp, score: result.score });
		}
	}

	// Sort by descending score
	candidates.sort((a, b) => b.score - a.score);
	return candidates;
}
