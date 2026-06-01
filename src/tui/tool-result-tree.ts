import { muted } from "./theme.ts";
import type { RenderTheme } from "./types.ts";

export type ToolResultTreeSection = { name: string; rows: Array<{ key: string; value: string }> };
export type ToolResultGroup = {
	name: string;
	rows: Array<[key: string, value: string | undefined]>;
};

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

export function toolResultTree(
	sections: ToolResultTreeSection[],
	terminalWidth: number,
	theme?: RenderTheme,
): string {
	if (sections.length === 0) return "";

	const keyColWidth = Math.max(1, ...sections.flatMap((s) => s.rows.map((r) => r.key.length)));

	const availableWidth = Math.max(20, terminalWidth - keyColWidth - 7);

	const lines: string[] = [];

	for (const section of sections) {
		if (lines.length > 0) lines.push("");
		lines.push(`  ${section.name}`);

		for (let ri = 0; ri < section.rows.length; ri++) {
			const { key, value } = section.rows[ri];
			const connector = ri === section.rows.length - 1 ? "\u2514\u2500 " : "\u251C\u2500 ";

			const valueLines = splitValueByWidth(value.replaceAll(/\s+/gu, " ").trim(), availableWidth);

			lines.push(`  ${muted(`${connector}${key.padEnd(keyColWidth)}  `, theme)}${valueLines[0]}`);

			for (let vi = 1; vi < valueLines.length; vi++)
				lines.push(`  ${muted("\u2502 ".padEnd(keyColWidth + 5), theme)}${valueLines[vi]}`);
		}
	}

	return lines.join("\n");
}

export function splitValueByWidth(value: string, maxChars: number): string[] {
	const lines: string[] = [];
	let remaining = value;
	while (remaining.length > maxChars) {
		let breakAt = remaining.lastIndexOf(" ", maxChars);
		if (breakAt <= 0) breakAt = maxChars;
		lines.push(remaining.slice(0, breakAt));
		remaining = remaining.slice(breakAt).trimStart();
	}
	if (remaining || lines.length === 0) lines.push(remaining);
	return lines;
}
