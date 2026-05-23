/**
 * @file Structured regex extraction — field-mapped patterns → JSON. Given a map of field names to
 *   regex patterns (with capture groups), extracts values from text content and returns structured
 *   JSON.
 */
export interface RegexExtractParams {
	/** Text content to extract from. */
	content: string;
	/** Field → regex pattern mapping. Each pattern should have exactly one capture group. */
	selectors: Record<string, string>;
	/** Regex flags (default "g" — global). */
	flags?: string;
	/** Max matches per pattern (default 5). */
	limit?: number;
}

export interface RegexExtractResult {
	/** Extracted values per field. */
	fields: Record<string, string[]>;
	/** Fields that had at least one match. */
	matchedFields: number;
	/** Total fields. */
	totalSelectors: number;
}

/** Run structured regex extraction against text content. */
export function extractRegexStructured(params: RegexExtractParams): RegexExtractResult {
	const fields: Record<string, string[]> = {};
	const flags = params.flags ?? "g";
	let matchedFields = 0;
	const limit = params.limit ?? 5;

	for (const [field, pattern] of Object.entries(params.selectors)) {
		const values: string[] = [];
		try {
			const regex = new RegExp(pattern, flags);
			let match: RegExpExecArray | null;
			while ((match = regex.exec(params.content)) !== null && values.length < limit) {
				const value = match.length > 1 ? match[1] : match[0];
				// Skip empty or whitespace-only matches
				if (value.trim()) {
					values.push(value.trim());
				}
				// Prevent infinite loop on zero-length matches
				if (match[0].length === 0) regex.lastIndex++;
			}
		} catch {
			// Invalid regex — skip this field
			fields[field] = [];
			continue;
		}
		fields[field] = values;
		if (values.length > 0) matchedFields++;
	}

	return {
		fields,
		matchedFields,
		totalSelectors: Object.keys(params.selectors).length,
	};
}
