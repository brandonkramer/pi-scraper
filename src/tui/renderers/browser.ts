import type { PiToolShell, ToolContext } from "../../types.ts";
import { toolExpandHint } from "../tool-labels.ts";
import { toolProgressLayout } from "../tool-progress.ts";
import { formatBytes, formatDuration, toolResourceStatus } from "../tool-resource.ts";
import {
	buildToolResultTree,
	toolResultTree,
	type ToolResultTreeSection,
} from "../tool-result-tree.ts";
import { toolStatus, toolStatusDot } from "../tool-status.ts";
import { muted as toolMuted, renderText as toolText } from "../tui.ts";
import type { RenderComponent, RenderTheme } from "../types.ts";

interface BrowserActionData {
	action?: string;
	url?: string;
	snapshot?: string;
	// screenshot
	blobPath?: string;
	byteLength?: number;
	width?: number;
	height?: number;
	fullPage?: boolean;
	selector?: string;
	// evaluate
	result?: string;
	truncated?: boolean;
}

export function renderWebBrowserResult(
	result: PiToolShell,
	expanded = false,
	theme?: RenderTheme,
): RenderComponent {
	const envelope = result.details as Partial<ToolContext<BrowserActionData>>;
	const data = envelope.data;
	// Status line, consistent with the other web tools: action · ● <code> · <backend> mode · duration · hint.
	const summary = toolStatus(
		[
			data?.action,
			envelope.error
				? { text: "failed", tone: "failure" }
				: envelope.status !== undefined
					? `${toolStatusDot(envelope.status, theme)} ${envelope.status}`
					: undefined,
			envelope.mode ? `${envelope.mode} mode` : undefined,
			formatDuration(envelope.timing?.durationMs),
			expanded ? undefined : toolExpandHint,
		],
		theme,
	);
	if (envelope.error) {
		return toolText(summary, { padToWidth: true });
	}
	const url = data?.url ?? envelope.url;
	const sections = resultSections(data);
	return toolProgressLayout(
		{
			body: (width) =>
				url ? toolResourceStatus({ url, label: "done", state: "done", width, theme }) : summary,
			summary: url ? summary : undefined,
			expanded,
			// Per-action result tree: snapshot refs, screenshot image facts, or evaluate output.
			expandedSections: (width) => [
				sections.length > 0
					? toolResultTree(sections, width, theme)
					: toolMuted("No details.", theme),
			],
			padToWidth: true,
		},
		theme,
	);
}

/** Per-action expanded sections: screenshot image facts, evaluate output, else the snapshot tree. */
function resultSections(data: BrowserActionData | undefined): ToolResultTreeSection[] {
	if (!data) return [];
	if (data.action === "screenshot") {
		const dims = data.width && data.height ? `${data.width}×${data.height}` : undefined;
		const mode = data.fullPage
			? "full-page"
			: data.selector
				? `element:${data.selector}`
				: "viewport";
		return buildToolResultTree([
			{
				name: "image",
				rows: [
					["path", data.blobPath],
					["type", dims ? `image/png · ${dims}` : "image/png"],
					["size", formatBytes(data.byteLength)],
					["mode", mode],
				],
			},
		]);
	}
	if (data.action === "evaluate") {
		return buildToolResultTree([
			{
				name: "result",
				rows: [
					["value", data.result],
					["truncated", data.truncated ? "yes" : undefined],
				],
			},
		]);
	}
	return snapshotSections(data.snapshot);
}

/** Parse the flat interactive snapshot into a tree section: `@ref → role "name"`. */
function snapshotSections(snapshot: string | undefined): ToolResultTreeSection[] {
	const rows = (snapshot ?? "")
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => {
			const ref = /\[ref=([^\]]+)\]/u.exec(line);
			const body = line.replace(/\s*\[ref=[^\]]+\]/u, "").trim();
			if (ref) return { key: `@${ref[1]}`, value: body };
			const role = /^\S+/u.exec(body)?.[0] ?? body;
			return { key: role, value: body.slice(role.length).trim() || body };
		});
	return rows.length > 0 ? [{ name: "snapshot", rows }] : [];
}
