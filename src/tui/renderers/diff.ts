/** @file Pi web_scrape/diff tool result renderer. */
import {
	isProgress,
	type PiToolShell,
	type ToolContext,
	type ProgressDetails,
} from "../../types.ts";
import {
	joinSegments as toolJoinSegments,
	muted as toolMuted,
	separator as toolSeparator,
} from "../theme.ts";
import { renderText as toolText } from "../tool-call.ts";
import { toolProgressCard } from "../tool-card.ts";
import {
	toolErrorLabel,
	toolFreshnessLabel,
	formatChecklistText as toolChecklistText,
} from "../tool-labels.ts";
import type { RenderComponent, RenderTheme } from "../types.ts";
export interface DiffData {
	previous?: unknown;
	current?: unknown;
	diff?: { changedCount?: number; addedCount?: number; removedCount?: number };
}

export function renderWebDiffResult(
	result: PiToolShell,
	expanded = false,
	theme?: RenderTheme,
): RenderComponent {
	const details = result.details as Partial<ToolContext<unknown>> | ProgressDetails;
	if (isProgress(details))
		return toolProgressCard("web_scrape diff", details, theme, { allowIcons: false });
	const envelope = details as Partial<ToolContext<DiffData>>;
	const diff = envelope.data;
	const title = envelope.error
		? toolErrorLabel("web_scrape", envelope.error, { allowIcons: false })
		: toolJoinSegments([
				!diff?.previous
					? "saved baseline"
					: envelope.summary?.includes("No meaningful") || envelope.summary?.includes("No content")
						? "no content changes"
						: `changed: ${diff.diff?.changedCount ?? 0} changed, ${diff.diff?.addedCount ?? 0} added, ${diff.diff?.removedCount ?? 0} removed`,
				toolFreshnessLabel(envelope),
			]);
	if (!expanded) {
		return toolText(`${title}${toolSeparator(theme)}${toolMuted("(ctrl+o to expand)", theme)}`, {
			padToWidth: true,
		});
	}
	const lines = [
		title,
		...(diff
			? [
					{
						label: "fetched current page",
						state: diff.current ? ("done" as const) : ("info" as const),
					},
					{
						label: "loaded previous snapshot",
						state: diff.previous ? ("done" as const) : ("warning" as const),
					},
					{ label: "compared normalized content", state: "done" as const },
					{
						label: "saved snapshot",
						state: envelope.responseId ? ("done" as const) : ("info" as const),
					},
				].map((c) => toolChecklistText(c))
			: []),
	];
	const preview = envelope.answerContext ?? result.content[0]?.text;
	if (preview) lines.push("", preview.slice(0, 500));
	if (envelope.responseId) lines.push("", toolMuted(`responseId: ${envelope.responseId}`, theme));
	return toolText(lines.join("\n"), { padToWidth: true });
}
