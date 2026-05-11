/** @file Serialize text module. */
/**
 * Normalizes whitespace in text for consistent output. Fast path: checks if normalization is needed
 * before applying regex transformations.
 */
export function normalizeWhitespace(text: string): string {
	// Quick check if text is already clean (most common case)
	// Look for any characters that need normalization: \r, \t, \n\n\n, or multiple spaces
	if (!/[\r\t]| \n|\n |\n{3,}| {2}/.test(text)) {
		return text.trim();
	}
	return text
		.replaceAll(/\r\n?/gu, "\n")
		.replaceAll(/[\t ]+/gu, " ")
		.replaceAll(/ *\n */gu, "\n")
		.replaceAll(/\n{3,}/gu, "\n\n")
		.trim();
}
