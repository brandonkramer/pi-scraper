import type { PiToolShell, ToolContext } from "../../types.ts";
/** @file Dedicated renderer for web_extract action="selector" text output. */
import { toolResultCard } from "../tool-card.ts";
import { toolResultId } from "../tool-result.ts";
import type { RenderComponent, RenderTheme } from "../types.ts";

export function renderWebExtractSelectorResult(
	result: PiToolShell,
	expanded = false,
	theme?: RenderTheme,
): RenderComponent {
	const envelope = result.details as Partial<ToolContext<unknown>> | undefined;
	const text = result.content[0]?.text ?? "";
	const ids = expanded
		? toolResultId([{ label: "responseId", id: envelope?.responseId ?? "" }], theme)
		: [];
	return toolResultCard({
		renderContent() {
			return ids.length > 0 ? [text, "", ...ids].join("\n") : text;
		},
		padToWidth: true,
	});
}
