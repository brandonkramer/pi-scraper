/**
 * @file ToolResultTree — grouped key/value tree component for expanded tool details. Tool renderers
 *   should use this semantic surface, not internal tree primitives.
 */
import { muted } from "./theme.ts";
import type { RenderTheme } from "./types.ts";

export interface ToolResultTreeSection {
	name: string;
	rows: Array<{ key: string; value: string }>;
}

export interface ToolResultGroup {
	name: string;
	rows: Array<[key: string, value: string | undefined]>;
}

/** Compose sections from a flat list of groups. Empty rows dropped. */
export function buildToolResultTree(groups: ToolResultGroup[]): ToolResultTreeSection[] {
	const sections: ToolResultTreeSection[] = [];
	for (const group of groups) {
		const rows = group.rows
			.filter(([, value]) => value !== undefined && value !== "")
			.map(([key, value]) => ({ key, value: value as string }));
		if (rows.length > 0) sections.push({ name: group.name, rows });
	}
	return sections;
}

/** Render grouped tool result sections to a terminal tree. */
export function toolResultTree(
	sections: ToolResultTreeSection[],
	terminalWidth: number,
	theme?: RenderTheme,
): string {
	if (sections.length === 0) return "";

	const keyColWidth = Math.max(1, ...sections.flatMap((s) => s.rows.map((r) => r.key.length)));

	const leftPad = 2;
	const connectorLen = 3;
	const afterKeyPad = 2;
	const valueStart = leftPad + connectorLen + keyColWidth + afterKeyPad;
	const availableWidth = Math.max(20, terminalWidth - valueStart);

	const lines: string[] = [];

	for (const section of sections) {
		if (lines.length > 0) lines.push("");
		lines.push(`  ${section.name}`);

		for (let ri = 0; ri < section.rows.length; ri++) {
			const { key, value } = section.rows[ri];
			const isLast = ri === section.rows.length - 1;
			const connector = isLast ? "\u2514\u2500 " : "\u251C\u2500 ";
			const paddedKey = key.padEnd(keyColWidth);

			const valueLines = splitValueByWidth(value, availableWidth);

			const prefix = `${connector}${paddedKey}  `;
			lines.push(`  ${muted(prefix, theme)}${valueLines[0]}`);

			for (let vi = 1; vi < valueLines.length; vi++) {
				const contPre = "\u2502 ".padEnd(connectorLen + keyColWidth + afterKeyPad);
				lines.push(`  ${muted(contPre, theme)}${valueLines[vi]}`);
			}
		}
	}

	return lines.join("\n");
}

export function splitValueByWidth(value: string, maxChars: number): string[] {
	if (value.length <= maxChars) return [value];
	const lines: string[] = [];
	let remaining = value;
	while (remaining.length > 0) {
		if (remaining.length <= maxChars) {
			lines.push(remaining);
			break;
		}
		let breakAt = remaining.lastIndexOf(" ", maxChars);
		if (breakAt <= 0) breakAt = maxChars;
		lines.push(remaining.slice(0, breakAt));
		remaining = remaining.slice(breakAt).trimStart();
	}
	return lines;
}
