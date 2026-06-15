import { Markdown } from "@earendil-works/pi-tui";

import { estimateTokenCount } from "../../parse/chunker.ts";
import type { LineMatch } from "../../scrape/line-filter.ts";
import { formatLineMatchPreview } from "../../scrape/line-preview.ts";
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
import { getMarkdownTheme, muted as toolMuted, renderText as toolText } from "../tui.ts";
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
	// read line-matching
	matches?: LineMatch[];
	needles?: string[];
	// read orientation digest (no needles)
	digest?: string;
}

export function renderWebBrowserResult(
	result: PiToolShell,
	expanded = false,
	theme?: RenderTheme,
): RenderComponent {
	const envelope = result.details as Partial<ToolContext<BrowserActionData>>;
	const data = envelope.data;
	// read rung: "map" (orientation digest), "N matches" (targeted), else nothing (plain read).
	const readMode =
		data?.action === "read"
			? Array.isArray(data.matches) && data.matches.length > 0
				? `${data.matches.length} match${data.matches.length === 1 ? "" : "es"}`
				: typeof data.digest === "string"
					? "map"
					: undefined
			: undefined;
	// Action carries its read rung inline, e.g. "read (map)" / "read (3 matches)".
	const actionLabel = data?.action
		? readMode
			? `${data.action} (${readMode})`
			: data.action
		: undefined;
	const statusSegment = envelope.error
		? { text: "failed", tone: "failure" as const }
		: envelope.status !== undefined
			? `${toolStatusDot(envelope.status, theme)} ${envelope.status}`
			: undefined;
	// Tokens the agent reads from this call: estimate over the returned text content (chars/4).
	const agentTokens = estimateTokenCount(result.content.map((c) => c.text).join("\n"));
	const tokenLabel = agentTokens > 0 ? `~${agentTokens.toLocaleString()} tok` : undefined;
	// Status line: ● <code> · action(rung) · <backend> mode · ~tokens · duration · hint — status leads.
	const summary = toolStatus(
		[
			statusSegment,
			actionLabel,
			envelope.mode ? `${envelope.mode} mode` : undefined,
			tokenLabel,
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
	// Both read modes render as markdown (like web_scrape) so they share the muted blockquote look:
	// a needled read shows its `> N:` match-snippet block; a needle-less read shows its orientation
	// digest as a quoted outline.
	const readData = data?.action === "read" ? data : undefined;
	const matchMarkdown =
		readData && Array.isArray(readData.matches) && readData.matches.length > 0
			? readMatchMarkdown(readData)
			: undefined;
	const previewMarkdown =
		matchMarkdown ??
		(readData && typeof readData.digest === "string"
			? readDigestMarkdown(readData.digest)
			: undefined);
	return toolProgressLayout(
		{
			body: (width) =>
				url ? toolResourceStatus({ url, label: "done", state: "done", width, theme }) : summary,
			summary: url ? summary : undefined,
			expanded,
			// Per-action result tree: snapshot refs, screenshot image facts, evaluate output. Both read
			// modes (digest or needled) render via markdownPreview instead, so this stays empty for them.
			expandedSections: (width) =>
				previewMarkdown
					? []
					: sections.length > 0
						? [toolResultTree(sections, width, theme)]
						: [toolMuted("No details.", theme)],
			markdownPreview:
				expanded && previewMarkdown
					? () => new Markdown(previewMarkdown, 0, 0, getMarkdownTheme(theme))
					: undefined,
			padToWidth: true,
		},
		theme,
	);
}

/** The needles line + matching-line-snippet block for a needle-filtered read, as markdown source. */
function readMatchMarkdown(data: BrowserActionData): string {
	const needles =
		Array.isArray(data.needles) && data.needles.length > 0
			? `needles: ${data.needles.map((n) => `"${n}"`).join(", ")}`
			: undefined;
	const preview = formatLineMatchPreview(data.matches, { maxChars: 2_000 });
	return [needles, preview].filter(Boolean).join("\n");
}

/**
 * The orientation digest as a muted blockquote: drop the `#` heading markers (indentation already
 * conveys level) and quote every line so it renders with the same `│` gutter as a needled read.
 */
function readDigestMarkdown(digest: string): string {
	return digest
		.split("\n")
		.map((line) => `> ${line.replace(/^(\s*)#{1,6}\s+/u, "$1· ")}`)
		.join("\n");
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
