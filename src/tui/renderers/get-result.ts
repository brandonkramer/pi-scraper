import type { PiToolShell } from "../../types.ts";
import { paintFg } from "../theme.ts";
import { toolStackedCard } from "../tool-card.ts";
import { toolResultTree } from "../tool-result-tree.ts";
import { buildExpandedResultDetails } from "../tool-result.ts";
import type { RenderComponent, RenderTheme } from "../types.ts";

export function renderGetResult(
	result: PiToolShell,
	expanded: boolean,
	theme?: RenderTheme,
): RenderComponent {
	const details = result.details as Record<string, unknown> | undefined;
	const hasError = !!details?.error;
	const sections = buildExpandedResultDetails(details);
	return toolStackedCard(
		{
			body: `└─ ${paintFg(theme, hasError ? "error" : "accent", hasError ? "✕ no result" : "✓ result found")}`,
			expanded,
			expandedSections: (width) => [toolResultTree(sections, width, theme)],
			hasError,
		},
		theme,
	);
}
