/** @file Simple JSONPath-like path extraction for manifest fields. */
export function extractJsonPath(obj: unknown, path: string): unknown {
	if (path === "$" || path === "") return obj;
	if (!path.startsWith("$.")) return path;
	const segments = path.slice(2).split(".");
	let current: unknown = obj;
	for (const segment of segments) {
		if (current === null || current === undefined) return undefined;
		const arrayMatch = segment.match(/^(.+)\[(\d+)\]$/u);
		if (arrayMatch) {
			const key = arrayMatch[1];
			const index = Number.parseInt(arrayMatch[2], 10);
			const arr = (current as Record<string, unknown>)[key];
			if (!Array.isArray(arr)) return undefined;
			current = arr[index];
		} else {
			current = (current as Record<string, unknown>)[segment];
		}
	}
	return current;
}
