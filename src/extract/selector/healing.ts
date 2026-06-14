/**
 * @file Selector self-healing — text-anchor fallback when direct and fingerprint-adaptive both
 *   fail. Parses a CSS selector to extract anchor signals (tag, class, id, attributes), then scans
 *   the document for semantic neighbors using weighted similarity: tag match, class overlap, text
 *   similarity, and parent tag match. If a stored fingerprint is available, its text and structural
 *   data strengthen the scoring.
 */

import { ElementType } from "domelementtype";
import { type Document, type Element, isTag } from "domhandler";
import { getElementsByTagType, textContent } from "domutils";

import { lineSimilarity } from "../../diff/compare.ts";
import type { ElementFingerprint } from "../../parse/adaptive/fingerprint.ts";

export interface HealedCandidate {
	element: Element;
	score: number;
	reasons: HealingReasons;
}

export interface HealingReasons {
	tag: number;
	class: number;
	text: number;
	attribute: number;
	parent: number;
}

export interface SelectorSignals {
	tag?: string;
	classes: string[];
	id?: string;
	attributes: Record<string, string>;
}

const HEAL_WEIGHTS = {
	tag: 0.2,
	class: 0.25,
	text: 0.3,
	attribute: 0.15,
	parent: 0.1,
} as const;

/** Parse a CSS selector into anchor signals for healing. */
export function parseSelectorSignals(selector: string): SelectorSignals {
	const signals: SelectorSignals = { classes: [], attributes: {} };

	// Extract tag (first word before any special char)
	const tagMatch = selector.match(/^[a-zA-Z][a-zA-Z0-9-]*/u);
	if (tagMatch) signals.tag = tagMatch[0].toLowerCase();

	// Extract .class fragments
	const classMatches = selector.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/gu);
	for (const m of classMatches) signals.classes.push(m[1].toLowerCase());

	// Extract #id
	const idMatch = selector.match(/#([a-zA-Z][a-zA-Z0-9_-]*)/u);
	if (idMatch) signals.id = idMatch[1].toLowerCase();

	// Extract [attr] or [attr="value"] fragments
	const attrMatches = selector.matchAll(/\[([a-zA-Z][a-zA-Z0-9-]*)(?:=["']?([^"'\]]+)["']?)?\]/gu);
	for (const m of attrMatches) {
		const key = m[1].toLowerCase();
		const value = m[2] || "";
		signals.attributes[key] = value.toLowerCase();
	}

	return signals;
}

/**
 * Heal a broken selector by finding the best semantic neighbor in the document.
 *
 * @param document — parsed htmlparser2 Document
 * @param selector — original CSS selector that returned 0 matches
 * @param threshold — minimum score (0–1) to accept a healed candidate
 * @param fingerprint — optional stored fingerprint to strengthen text/structural matching
 * @returns Sorted candidates (descending score), empty if none above threshold
 */
export function healSelectorMatch(
	document: Document,
	selector: string,
	threshold: number,
	fingerprint?: ElementFingerprint,
): HealedCandidate[] {
	const signals = parseSelectorSignals(selector);
	const all = getElementsByTagType(ElementType.Tag, document, true).filter((el): el is Element =>
		isTag(el),
	);

	const candidates: HealedCandidate[] = [];
	for (const element of all) {
		const reasons = scoreHealingReasons(element, signals, fingerprint);
		const score =
			reasons.tag * HEAL_WEIGHTS.tag +
			reasons.class * HEAL_WEIGHTS.class +
			reasons.text * HEAL_WEIGHTS.text +
			reasons.attribute * HEAL_WEIGHTS.attribute +
			reasons.parent * HEAL_WEIGHTS.parent;

		const rounded = Math.round(score * 1_000) / 1_000;
		if (rounded >= threshold) {
			candidates.push({ element, score: rounded, reasons });
		}
	}

	candidates.sort((a, b) => b.score - a.score);
	return candidates;
}

function scoreHealingReasons(
	element: Element,
	signals: SelectorSignals,
	fingerprint?: ElementFingerprint,
): HealingReasons {
	const elTag = element.name.toLowerCase();
	const rawClass: string = element.attribs.class || "";
	const elClasses = rawClass
		.split(/\s+/u)
		.filter(Boolean)
		.map((c) => c.toLowerCase());
	const elText = textContent(element).trim();
	const parentTag =
		element.parent && isTag(element.parent) ? element.parent.name.toLowerCase() : "";

	// Tag score
	let tag = 0;
	if (signals.tag) {
		tag = elTag === signals.tag ? 1 : 0;
	} else if (fingerprint?.tag) {
		tag = elTag === fingerprint.tag ? 1 : 0;
	}

	// Class overlap (Jaccard)
	let classScore = 0;
	if (signals.classes.length > 0 && elClasses.length > 0) {
		const intersection = signals.classes.filter((c) => elClasses.includes(c)).length;
		const union = new Set([...signals.classes, ...elClasses]).size;
		classScore = intersection / union;
	} else if (signals.classes.length === 0 && elClasses.length === 0) {
		classScore = 1;
	}

	// Text similarity
	let text = 0;
	const fpText = fingerprint?.fullText ?? fingerprint?.text ?? "";
	const signalText = Object.values(signals.attributes).join(" ");
	if (fpText && elText) {
		text = lineSimilarity(fpText, elText);
	} else if (signalText && elText) {
		text = lineSimilarity(signalText, elText);
	} else if (!fpText && !signalText && !elText) {
		text = 1;
	}

	// Attribute overlap
	let attribute = 0;
	const signalAttrKeys = Object.keys(signals.attributes);
	if (signalAttrKeys.length > 0) {
		let matches = 0;
		for (const key of signalAttrKeys) {
			const elValue = element.attribs[key] ?? "";
			if (!elValue) continue;
			const expected = signals.attributes[key] ?? "";
			if (
				!expected ||
				elValue.toLowerCase().includes(expected) ||
				expected.includes(elValue.toLowerCase())
			) {
				matches += 1;
			}
		}
		attribute = matches / signalAttrKeys.length;
	} else if (fingerprint?.attributes) {
		const fpKeys = Object.keys(fingerprint.attributes);
		if (fpKeys.length > 0) {
			let matches = 0;
			for (const key of fpKeys) {
				const elValue = element.attribs[key] ?? "";
				if (!elValue) continue;
				const fpValue = fingerprint.attributes[key] ?? "";
				if (
					elValue.toLowerCase().includes(fpValue.toLowerCase()) ||
					fpValue.toLowerCase().includes(elValue.toLowerCase())
				) {
					matches += 1;
				}
			}
			attribute = matches / fpKeys.length;
		} else {
			attribute = 1;
		}
	} else {
		attribute = 1;
	}

	// Parent tag match
	let parent = 0;
	if (fingerprint?.parent?.tag) {
		parent = parentTag === fingerprint.parent.tag.toLowerCase() ? 1 : 0;
	} else if (signals.tag) {
		// Weak signal: any parent is better than none
		parent = parentTag ? 0.5 : 0;
	} else {
		parent = 1;
	}

	return { tag, class: classScore, text, attribute, parent };
}
