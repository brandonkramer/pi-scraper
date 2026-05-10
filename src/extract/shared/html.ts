/**
 * @fileoverview DOM-specific HTML helpers (text utilities moved to text.ts).
 */
import type { AnyNode } from "domhandler";
import * as domutils from "domutils";

export function followingSectionNodes(
	heading: AnyNode,
	level: number,
): AnyNode[] {
	const nodes: AnyNode[] = [];
	let next = (heading as { next?: AnyNode }).next;
	while (next) {
		if (domutils.isTag(next) && /^h[1-6]$/u.test(next.name)) {
			const nextLevel = Number.parseInt(next.name.slice(1), 10);
			if (nextLevel <= level) break;
		}
		nodes.push(next);
		next = (next as { next?: AnyNode }).next;
	}
	return nodes;
}
