/**
 * @file Reusable tree-section layout — connector-prefixed key/value rows grouped by section with
 *   value wrapping and continuation markers. Used by scrape, batch, and crawl expanded details.
 */
import { muted } from "./theme.ts";
import type { RenderTheme } from "./types.ts";

export interface TreeSection {
	name: string;
	rows: Array<{ key: string; value: string }>;
}

export interface TreeBuilder {
	sections: TreeSection[];
	add(section: string, key: string, value: string | undefined): void;
}

export function createTreeBuilder(): TreeBuilder {
	const sections: TreeSection[] = [];
	return {
		sections,
		add(section, key, value) {
			if (value === undefined || value === "") return;
			let sec = sections.find((s) => s.name === section);
			if (!sec) sections.push((sec = { name: section, rows: [] }));
			sec.rows.push({ key, value });
		},
	};
}

export function renderTreeSections(
	sections: TreeSection[],
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

function splitValueByWidth(value: string, maxChars: number): string[] {
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
