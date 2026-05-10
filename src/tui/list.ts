/**
 * @fileoverview Pi terminal UI list rendering primitives.
 */
import type { RenderTheme } from "./types.ts";
import { muted } from "./theme.ts";

export interface ListRow {
	label: string;
	badge?: string;
}

export interface ListRenderOptions {
	rows: readonly ListRow[];
	moreCount?: number;
	expanded?: boolean;
	rowRender?: (row: ListRow, width: number, theme?: RenderTheme) => string;
	renderMore?: (count: number, theme?: RenderTheme) => string;
	renderTitle?: (count: number, theme?: RenderTheme) => string;
	theme?: RenderTheme;
}

export function renderListText(
	options: ListRenderOptions,
	width: number,
): string {
	const { rows, moreCount, expanded, theme } = options;
	const rowFn =
		options.rowRender ?? ((row, w, t) => renderDefaultListRow(row, w, t));
	const moreFn =
		options.renderMore ??
		((count, t) => muted(`… ${count} more`, t) ?? `… ${count} more`);
	const titleFn =
		options.renderTitle ??
		((count, t) =>
			muted(`${count} row${count === 1 ? "" : "s"}`, t) ??
			`${count} row${count === 1 ? "" : "s"}`);
	const visible = expanded ? rows.length : Math.min(rows.length, 12);
	const rendered = rows
		.slice(0, visible)
		.map((row) => rowFn(row, width, theme));
	if (!expanded && moreCount && moreCount > 0)
		rendered.push(moreFn(moreCount, theme));
	if (rendered.length === 0) return titleFn(rows.length, theme);
	return rendered.join("\n");
}

function renderDefaultListRow(
	row: ListRow,
	width: number,
	theme?: RenderTheme,
): string {
	const badgeText = row.badge ? `[ ${row.badge} ]` : "";
	const badgeWidth = badgeText.length;
	const labelWidth = Math.max(12, width - badgeWidth - 2);
	let label = row.label;
	if (label.length > labelWidth) {
		const left = Math.ceil((labelWidth - 1) / 2);
		const right = Math.floor((labelWidth - 1) / 2);
		label = `${label.slice(0, left)}…${label.slice(label.length - right)}`;
	} else {
		label = label.padEnd(labelWidth, " ");
	}
	const badge = badgeText ? (muted(badgeText, theme) ?? badgeText) : "";
	return badge ? `${label} ${badge}` : label;
}
