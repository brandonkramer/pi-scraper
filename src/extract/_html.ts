/**
 * @fileoverview Shared HTML text helpers used by api-surface and vertical extractors.
 */
import type { AnyNode } from "domhandler";
import * as domutils from "domutils";

export function cleanText(value: unknown): string {
	return typeof value === "string" ? value.replace(/\s+/gu, " ").trim() : "";
}

export function titleCase(value: string): string {
	return value
		.replace(/[-_]+/gu, " ")
		.replace(/\b\w/gu, (char) => char.toUpperCase());
}

export function stripUndefined<T extends object>(value: T): T {
	return Object.fromEntries(
		Object.entries(value).filter(
			([, item]) => item !== undefined && item !== "",
		),
	) as T;
}

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
