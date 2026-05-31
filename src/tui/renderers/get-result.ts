/** @file Pi web_get_result renderer component. */
import type { PiToolShell } from "../../types.ts";
import { paintFg } from "../theme.ts";
import { defineResultRenderer } from "../tool-card.ts";
import { toolResultTree } from "../tool-result-tree.ts";
import { buildExpandedResultDetails } from "../tool-result.ts";
import { paintFirstLineBg } from "../tool-status.ts";
import type { RenderComponent, RenderTheme } from "../types.ts";

/** Render web_get_result with a summary header and a field tree in expanded view. */
export function renderGetResult(
	result: PiToolShell,
	expanded: boolean,
	theme?: RenderTheme,
): RenderComponent {
	const details = result.details as Record<string, unknown> | undefined;
	const hasError = !!details?.error;
	const statusLine = paintFg(
		theme,
		hasError ? "error" : "accent",
		hasError ? "✕ no result" : "✓ result found",
	);
	const sections = buildExpandedResultDetails(details);
	return defineResultRenderer({
		renderContent(width) {
			const lines = [`└─ ${statusLine}`];
			if (expanded && sections.length > 0) {
				const tree = toolResultTree(sections, width, theme);
				if (tree) lines.push("", ...tree.split("\n"));
			}
			return lines.join("\n");
		},
		mapLines: hasError ? (lines) => paintFirstLineBg(lines, "toolErrorBg", theme) : undefined,
	});
}
