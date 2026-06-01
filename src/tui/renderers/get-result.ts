import type { PiToolShell } from "../../types.ts";
import { toolProgressLayout } from "../tool-progress.ts";
import { toolResultTree } from "../tool-result-tree.ts";
import { buildToolResultDetails } from "../tool-result.ts";
import { paintFg } from "../tui.ts";
import type { RenderComponent, RenderTheme } from "../types.ts";

export function renderGetResult(
	result: PiToolShell,
	expanded: boolean,
	theme?: RenderTheme,
): RenderComponent {
	const details = result.details as Record<string, unknown> | undefined;
	return toolProgressLayout(
		{
			body: `└─ ${paintFg(theme, details?.error ? "error" : "accent", details?.error ? "✕ no result" : "✓ result found")}`,
			expanded,
			expandedSections: (width) => [toolResultTree(buildToolResultDetails(details), width, theme)],
			hasError: !!details?.error,
		},
		theme,
	);
}
