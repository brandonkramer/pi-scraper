import type { PiToolShell } from "../../types.ts";
import { toolResultCard } from "../tool-card.ts";
import type { RenderComponent, RenderTheme } from "../types.ts";

export function renderWebExtractSelectorResult(
	result: PiToolShell,
	expanded = false,
	theme?: RenderTheme,
): RenderComponent {
	return toolResultCard(
		{
			body: result.content[0]?.text ?? "",
			expanded,
			responseId: (result.details as { responseId?: string } | undefined)?.responseId,
			padToWidth: true,
		},
		theme,
	);
}
