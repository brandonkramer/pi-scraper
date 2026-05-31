import type { PiToolShell } from "../../types.ts";
import { paintFg } from "../theme.ts";
import { defineResultRenderer } from "../tool-card.ts";
import { toolResultTree } from "../tool-result-tree.ts";
import { buildExpandedResultDetails } from "../tool-result.ts";
import { paintFirstLineBg } from "../tool-status.ts";
import type { RenderComponent, RenderTheme } from "../types.ts";

export function renderGetResult(
	result: PiToolShell,
	expanded: boolean,
	theme?: RenderTheme,
): RenderComponent {
	const details = result.details as Record<string, unknown> | undefined;
	const hasError = !!details?.error;
	const sections = buildExpandedResultDetails(details);
	return defineResultRenderer({
		renderContent(width) {
			const lines = [
				`└─ ${paintFg(theme, hasError ? "error" : "accent", hasError ? "✕ no result" : "✓ result found")}`,
			];
			if (expanded && sections.length > 0) {
				const tree = toolResultTree(sections, width, theme);
				if (tree) lines.push("", ...tree.split("\n"));
			}
			return lines.join("\n");
		},
		mapLines: hasError ? (lines) => paintFirstLineBg(lines, "toolErrorBg", theme) : undefined,
	});
}
