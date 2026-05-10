/**
 * @fileoverview Pi web_diff tool result renderer.
 */
import {
	isProgress,
	type PiToolShell,
	type ResultEnvelope,
	type ProgressDetails,
} from "../types.ts";
import type { RenderComponent, RenderTheme } from "../tui/types.ts";
import { renderText } from "./render.ts";
import { metadataText, separator } from "../tui/theme.ts";
import { formatChecklistItem, formatChecklistText } from "../tui/checklist.ts";
import { renderProgress } from "../tui/progress-card.ts";
import { errorTitle, freshnessLabel } from "../tui/envelope-labels.ts";
import type { DiffData } from "./web-renderer-views.ts";

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
	const details = result.details as
		| Partial<ResultEnvelope<unknown>>
		| ProgressDetails;
	if (isProgress(details))
		return renderProgress("web_diff", details as ProgressDetails, theme, {
			allowIcons: false,
		});
	const envelope = details as Partial<ResultEnvelope<DiffData>>;
	const diff = envelope.data;
	const title = envelope.error
		? errorTitle("web_diff", envelope.error, { allowIcons: false })
		: [diffTitle(diff, envelope.summary), freshnessLabel(envelope)]
				.filter(Boolean)
				.join(separator());
	return renderChecklistResult(
		title,
		expanded,
		{
			items: [
				{
					label: "fetched current page",
					state: diff?.current ? "done" : "info",
				},
				{
					label: "loaded previous snapshot",
					state: diff?.previous ? "done" : "warning",
				},
				{
					label: "compared normalized content",
					state: diff ? "done" : "info",
				},
				{
					label: "saved snapshot",
					state: envelope.responseId ? "done" : "info",
				},
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
		const hint = metadataText("(ctrl+o to expand)", theme);
		const notice = options.notice
			? `\n\n${metadataText(options.notice, theme)}`
			: "";
		return renderText(`${title}${separator(theme)}${hint}${notice}`, {
			padToWidth: true,
			truncate: true,
		});
	}
	const lines = [title];
	if (options.notice) lines.push("", metadataText(options.notice, theme));
	if (options.items?.length) {
		const formatter =
			options.icons === false ? formatChecklistText : formatChecklistItem;
		lines.push("", ...options.items.map(formatter));
	}
	if (options.preview) lines.push("", options.preview.slice(0, 500));
	if (options.responseId)
		lines.push("", metadataText(`responseId: ${options.responseId}`, theme));
	return renderText(lines.join("\n"), { padToWidth: true });
}

function diffTitle(
	diff: DiffData | undefined,
	summary: string | undefined,
): string {
	if (!diff?.previous) return "saved baseline";
	if (summary?.includes("No meaningful") || summary?.includes("No content"))
		return "no content changes";
	return `changed: ${diff.diff?.changedCount ?? 0} changed, ${diff.diff?.addedCount ?? 0} added, ${diff.diff?.removedCount ?? 0} removed`;
}
