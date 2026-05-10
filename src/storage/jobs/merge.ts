/**
 * @fileoverview Shared job manifest merge utilities.
 */

/**
 * Merge two optional string arrays, deduplicating and filtering empties.
 */
export function mergeUnique(
	left: string[] | undefined,
	right: string[] | undefined,
): string[] | undefined {
	const merged = [...(left ?? []), ...(right ?? [])].filter(Boolean);
	return merged.length ? [...new Set(merged)] : undefined;
}
