/**
 * @fileoverview Stable de-duplication helpers for URL-adjacent collections.
 */

export function dedupeBy<T>(
	items: readonly T[],
	keyFor: (item: T) => string,
): T[] {
	const seen = new Set<string>();
	return items.filter((item) => {
		const key = keyFor(item);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}
