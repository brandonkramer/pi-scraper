/**
 * @file Source-grounded extraction — post-hoc text matcher for LLM extraction results. Walks the
 *   structured JSON output from an LLM and locates each extracted string value in the cleaned
 *   source text, producing character-offset source spans for auditability.
 */

export interface SourceSpan {
	/** Character offset where the value starts in the source text. */
	start: number;
	/** Character offset where the value ends (exclusive). */
	end: number;
}

export interface GroundedField {
	/** Dot-notation path to the field (e.g. "title" or "product.price"). */
	field: string;
	/** The extracted value. */
	value: unknown;
	/** Source span if the value was found in the text; null if unverifiable. */
	sourceSpan: SourceSpan | null;
}

/**
 * Post-process an LLM extraction result to add source grounding.
 *
 * Recursively walks the data structure. For every string leaf, searches the source text for the
 * value. Returns a flat list of grounded fields with dot-notation paths.
 *
 * @param data — LLM extraction output (any JSON shape)
 * @param sourceText — cleaned text the LLM consumed (markdown or plain text)
 * @returns Flat list of fields with source spans
 */
export function groundExtractionResult(data: unknown, sourceText: string): GroundedField[] {
	const results: GroundedField[] = [];
	walkAndGround(data, "", sourceText, results);
	return results;
}

function walkAndGround(
	value: unknown,
	path: string,
	sourceText: string,
	out: GroundedField[],
): void {
	if (value === null || value === undefined) {
		out.push({ field: path || "(root)", value, sourceSpan: null });
		return;
	}

	if (typeof value === "string") {
		out.push({ field: path || "(root)", value, sourceSpan: findSpan(value, sourceText) });
		return;
	}

	if (typeof value === "number" || typeof value === "boolean") {
		// Try string representation for numbers/booleans
		const asString = String(value);
		out.push({
			field: path || "(root)",
			value,
			sourceSpan: findSpan(asString, sourceText),
		});
		return;
	}

	if (Array.isArray(value)) {
		if (value.length === 0) {
			out.push({ field: path || "(root)", value, sourceSpan: null });
		}
		for (let i = 0; i < value.length; i++) {
			const childPath = path ? `${path}.${i}` : String(i);
			walkAndGround(value[i], childPath, sourceText, out);
		}
		return;
	}

	if (typeof value === "object") {
		const entries = Object.entries(value);
		if (entries.length === 0) {
			out.push({ field: path || "(root)", value, sourceSpan: null });
		}
		for (const [key, childValue] of entries) {
			const childPath = path ? `${path}.${key}` : key;
			walkAndGround(childValue, childPath, sourceText, out);
		}
	}
}

/**
 * Find the first occurrence of a value in source text. Tries exact match first, then
 * case-insensitive, then whitespace-collapsed.
 */
function findSpan(needle: string, haystack: string): SourceSpan | null {
	if (!needle || !haystack) return null;

	// Exact match
	const exact = haystack.indexOf(needle);
	if (exact !== -1) {
		return { start: exact, end: exact + needle.length };
	}

	// Case-insensitive match
	const lowerNeedle = needle.toLowerCase();
	const lowerHaystack = haystack.toLowerCase();
	const ci = lowerHaystack.indexOf(lowerNeedle);
	if (ci !== -1) {
		return { start: ci, end: ci + needle.length };
	}

	// Whitespace-collapsed match (normalize internal whitespace)
	const collapsedNeedle = needle.replaceAll(/\s+/gu, " ").trim();
	const collapsedHaystack = haystack.replaceAll(/\s+/gu, " ");
	const collapsed = collapsedHaystack.indexOf(collapsedNeedle);
	if (collapsed !== -1) {
		return { start: collapsed, end: collapsed + collapsedNeedle.length };
	}

	return null;
}
