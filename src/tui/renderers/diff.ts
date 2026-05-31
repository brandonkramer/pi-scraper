/** @file Pi web_scrape/diff tool result renderer. */
import {
	isProgress,
	type PiToolShell,
	type ToolContext,
	type ProgressDetails,
} from "../../types.ts";
import { toolProgressCard } from "../tool-card.ts";
import { toolChecklistItem, toolChecklistText } from "../tool-format.ts";
import { toolErrorLabel, toolFreshnessLabel } from "../tool-labels.ts";
import { toolJoinSegments, toolMuted, toolSeparator, toolText } from "../tool-text.ts";
import type { RenderComponent, RenderTheme } from "../types.ts";
export interface DiffData {
	previous?: unknown;
	current?: unknown;
	diff?: { changedCount?: number; addedCount?: number; removedCount?: number };
}

export type ChecklistState = "done" | "pending" | "failed" | "warning" | "info";

export interface ChecklistItem {
	label: string;
	state: ChecklistState;
	detail?: string;
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
		: toolJoinSegments([diffTitle(diff, envelope.summary), toolFreshnessLabel(envelope)]);
	return renderChecklistResult(
		title,
		expanded,
		{
			items: [
				{ label: "fetched current page", state: diff?.current ? "done" : "info" },
				{ label: "loaded previous snapshot", state: diff?.previous ? "done" : "warning" },
				{ label: "compared normalized content", state: diff ? "done" : "info" },
				{ label: "saved snapshot", state: envelope.responseId ? "done" : "info" },
			],
			preview: envelope.answerContext ?? result.content[0]?.text,
			responseId: envelope.responseId,
			icons: false,
		},
		theme,
	);
}

export function renderChecklistResult(
	title: string,
	expanded: boolean,
	options: {
		items?: ChecklistItem[];
		notice?: string;
		preview?: string;
		responseId?: string;
		icons?: boolean;
	},
	theme?: RenderTheme,
): RenderComponent {
	if (!expanded) {
		const notice = options.notice ? `\n\n${toolMuted(options.notice, theme)}` : "";
		return toolText(
			`${title}${toolSeparator(theme)}${toolMuted("(ctrl+o to expand)", theme)}${notice}`,
			{
				padToWidth: true,
			},
		);
	}
	const lines = [title];
	if (options.notice) lines.push("", toolMuted(options.notice, theme));
	if (options.items?.length) {
		const fmt = options.icons === false ? toolChecklistText : toolChecklistItem;
		lines.push("", ...options.items.map(fmt));
	}
	if (options.preview) lines.push("", options.preview.slice(0, 500));
	if (options.responseId) lines.push("", toolMuted(`responseId: ${options.responseId}`, theme));
	return toolText(lines.join("\n"), { padToWidth: true });
}

function diffTitle(diff: DiffData | undefined, summary: string | undefined): string {
	if (!diff?.previous) return "saved baseline";
	if (summary?.includes("No meaningful") || summary?.includes("No content"))
		return "no content changes";
	return `changed: ${diff.diff?.changedCount ?? 0} changed, ${diff.diff?.addedCount ?? 0} added, ${diff.diff?.removedCount ?? 0} removed`;
}
