import { isProgress, type PiToolShell, type ToolContext } from "../../types.ts";
import { muted as toolMuted } from "../theme.ts";
import { renderText as toolText } from "../tool-call.ts";
import { toolProgressCard, toolResultCard } from "../tool-card.ts";
import { toolExpandHint } from "../tool-labels.ts";
import { toolProcess } from "../tool-process.ts";
import { toolResource } from "../tool-resource.ts";
import type { RenderComponent, RenderTheme } from "../types.ts";
export function renderWebMapResult(
	result: PiToolShell,
	expanded = false,
	theme?: RenderTheme,
): RenderComponent {
	const envelope = result.details as Partial<
		ToolContext<{ urls?: { url: string; source?: string; title?: string }[] }>
	>;
	if (isProgress(envelope))
		return toolProgressCard("web_map", envelope, theme, { allowIcons: false });
	const urls = Array.isArray(envelope.data?.urls) ? envelope.data.urls : [];
	const summary = toolProcess(`${urls.length} URL(s)`, [!expanded && toolExpandHint], theme);
	if (urls.length === 0)
		return toolText(`${summary}\n\n${toolMuted("No URLs discovered.", theme)}`, {
			padToWidth: true,
		});
	return toolResultCard({
		renderContent(width) {
			const rows = urls
				.slice(0, expanded ? 50 : 12)
				.map((entry) => toolResource({ url: entry.url, badge: entry.source, width, theme }));
			if (urls.length > rows.length)
				rows.push(toolMuted(`… ${urls.length - rows.length} more urls`, theme));
			const lines = [summary, rows.join("\n")];
			if (expanded && envelope.responseId)
				lines.push("", toolMuted(`responseId: ${envelope.responseId}`, theme));
			return lines.join("\n");
		},
		padToWidth: true,
	});
}
