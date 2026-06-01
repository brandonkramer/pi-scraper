import type { PiToolShell, ToolContext } from "../../types.ts";
import { toolResultCard } from "../tool-card.ts";
import type { RenderComponent, RenderTheme } from "../types.ts";

export function renderWebExtractSelectorResult(
	result: PiToolShell,
	expanded = false,
	theme?: RenderTheme,
): RenderComponent {
	const envelope = result.details as Partial<ToolContext<unknown>> | undefined;
	return toolResultCard(
		{
			body: result.content[0]?.text ?? "",
			expanded,
			responseId: envelope?.responseId,
			padToWidth: true,
		},
		theme,
	);
}
