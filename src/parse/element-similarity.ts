/**
 * @fileoverview Compare element fingerprints and score similarity.
 *
 * @remarks
 * Reuses existing diff/text utilities (Levenshtein, token Jaccard) from
 * {@link src/diff/compare.ts} rather than duplicating algorithms.
 */
import { lineSimilarity, tokens } from "../diff/compare.js";
import type { ElementFingerprint } from "./element-fingerprint.js";

/**
 * Weights for each fingerprint feature when computing overall similarity.
 */
const WEIGHTS = {
	tag: 0.1,
	text: 0.25,
	attributes: 0.25,
	path: 0.15,
	parent: 0.1,
	siblings: 0.075,
	children: 0.075,
} as const;

/** Individual feature scores and overall score. */
export interface SimilarityResult {
	/** 0–1 overall score. */
	score: number;

	/** Per-feature breakdown. */
	reasons: {
		tag: number;
		text: number;
		attributes: number;
		path: number;
		parent: number;
		siblings: number;
		children: number;
	};
}

/**
 * Compare two fingerprints and return a similarity score.
 *
 * @param stored — fingerprint retrieved from storage
 * @param candidate — fingerprint of a candidate element in the current page
 * @returns score and per-feature reasons
 */
export function compareFingerprints(
	stored: ElementFingerprint,
	candidate: ElementFingerprint,
): SimilarityResult {
	const tagScore = tagSimilarity(stored, candidate);
	const textScore = textSimilarity(stored, candidate);
	const attrScore = attributeSimilarity(stored, candidate);
	const pathScore = pathSimilarity(stored, candidate);
	const parentScore = parentSimilarity(stored, candidate);
	const siblingScore = sequenceSimilarity(stored.siblings, candidate.siblings);
	const childScore = sequenceSimilarity(stored.children, candidate.children);

	const score =
		tagScore * WEIGHTS.tag +
		textScore * WEIGHTS.text +
		attrScore * WEIGHTS.attributes +
		pathScore * WEIGHTS.path +
		parentScore * WEIGHTS.parent +
		siblingScore * WEIGHTS.siblings +
		childScore * WEIGHTS.children;

	return {
		score: Math.round(score * 1_000) / 1_000,
		reasons: {
			tag: Math.round(tagScore * 1_000) / 1_000,
			text: Math.round(textScore * 1_000) / 1_000,
			attributes: Math.round(attrScore * 1_000) / 1_000,
			path: Math.round(pathScore * 1_000) / 1_000,
			parent: Math.round(parentScore * 1_000) / 1_000,
			siblings: Math.round(siblingScore * 1_000) / 1_000,
			children: Math.round(childScore * 1_000) / 1_000,
		},
	};
}

function tagSimilarity(a: ElementFingerprint, b: ElementFingerprint): number {
	return a.tag === b.tag ? 1 : 0;
}

function textSimilarity(a: ElementFingerprint, b: ElementFingerprint): number {
	// Use lineSimilarity which combines character and token similarity
	const left = a.fullText ?? a.text ?? "";
	const right = b.fullText ?? b.text ?? "";
	if (left === right) return 1;
	if (!left || !right) return 0;
	return lineSimilarity(left, right);
}

function attributeSimilarity(
	a: ElementFingerprint,
	b: ElementFingerprint,
): number {
	const aKeys = Object.keys(a.attributes);
	const bKeys = Object.keys(b.attributes);
	if (aKeys.length === 0 && bKeys.length === 0) return 1;
	if (aKeys.length === 0 || bKeys.length === 0) return 0;

	let matches = 0;
	let valueScoreSum = 0;
	for (const key of aKeys) {
		if (b.attributes[key] === undefined) continue;
		matches += 1;
		const av = a.attributes[key] ?? "";
		const bv = b.attributes[key] ?? "";
		valueScoreSum += av === bv ? 1 : lineSimilarity(av, bv);
	}

	// Key overlap * average value similarity
	const keyOverlap = matches / Math.max(aKeys.length, bKeys.length);
	const avgValueScore = matches > 0 ? valueScoreSum / matches : 0;
	return (keyOverlap + avgValueScore) / 2;
}

function pathSimilarity(a: ElementFingerprint, b: ElementFingerprint): number {
	const left = a.path.join(" > ");
	const right = b.path.join(" > ");
	if (left === right) return 1;
	return lineSimilarity(left, right);
}

function parentSimilarity(
	a: ElementFingerprint,
	b: ElementFingerprint,
): number {
	if (!a.parent && !b.parent) return 1;
	if (!a.parent || !b.parent) return 0;

	let score = 0;
	if (a.parent.tag === b.parent.tag) score += 0.4;
	const aParentText = a.parent.text ?? "";
	const bParentText = b.parent.text ?? "";
	if (aParentText && bParentText) {
		score += lineSimilarity(aParentText, bParentText) * 0.3;
	}
	const aParentAttrs = Object.keys(a.parent.attributes);
	const bParentAttrs = Object.keys(b.parent.attributes);
	if (aParentAttrs.length > 0 || bParentAttrs.length > 0) {
		const shared = aParentAttrs.filter((k) => bParentAttrs.includes(k)).length;
		score +=
			(shared / Math.max(aParentAttrs.length, bParentAttrs.length)) * 0.3;
	} else {
		score += 0.3;
	}
	return Math.min(score, 1);
}

function sequenceSimilarity(
	a: string[] | undefined,
	b: string[] | undefined,
): number {
	if (!a && !b) return 1;
	if (!a || !b) return 0;
	const left = a.join(" ");
	const right = b.join(" ");
	if (left === right) return 1;
	return lineSimilarity(left, right);
}

// Re-export for tests
export { lineSimilarity, tokens };
