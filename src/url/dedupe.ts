/** @file Stable array and collection helpers for URL-adjacent code. */

export function dedupeBy<T>(items: readonly T[], keyFor: (item: T) => string): T[] {
	const seen = new Set<string>();
	return items.filter((item) => {
		const key = keyFor(item);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

const MIN_COMPACT_THRESHOLD = 1024;

export function compactQueue(queue: unknown[], head: number): number {
	if (head < MIN_COMPACT_THRESHOLD || head <= queue.length - head) {
		return head;
	}
	queue.splice(0, head);
	return 0;
}
