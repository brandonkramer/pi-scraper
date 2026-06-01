import type { PiToolShell } from "../../types.ts";
import { toolProgressLayout } from "../tool-progress.ts";
import type { RenderComponent, RenderTheme } from "../types.ts";

export function renderWebExtractSelectorResult(
	result: PiToolShell,
	expanded = false,
	theme?: RenderTheme,
): RenderComponent {
	return toolProgressLayout(
		{
			body: result.content[0]?.text ?? "",
			expanded,
			responseId: (result.details as { responseId?: string } | undefined)?.responseId,
			padToWidth: true,
		},
		theme,
	);
}
