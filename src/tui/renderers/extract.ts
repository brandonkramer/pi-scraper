/** @file Dedicated web_extract renderer for non-vertical, non-selector extraction results. */
import { Markdown } from "@earendil-works/pi-tui";

import type { PiToolShell, ToolContext } from "../../types.ts";
import { toolResultCard } from "../tool-card.ts";
import { toolResourceStatus } from "../tool-resource.ts";
import { toolResultTree } from "../tool-result-tree.ts";
import { buildExpandedResultDetails, toolResultId } from "../tool-result.ts";
import { toolStatusDot, toolStatus } from "../tool-status.ts";
import { toolMarkdownTheme } from "../tool-text.ts";
import type { RenderComponent, RenderTheme } from "../types.ts";

export function renderWebExtractResult(
	result: PiToolShell,
	expanded = false,
	theme?: RenderTheme,
): RenderComponent {
	const details = result.details as Partial<ToolContext<unknown>> | undefined;
	const preview = result.content[0]?.text ?? "";
	const summary = extractSummary(details, theme);
	const body = expanded ? expandedExtractText(summary, preview, details) : summary;
	const hasLongMarkdown = expanded && details?.format === "markdown" && preview.length > 100;
	return toolResultCard({
		renderContent(width) {
			const loader = extractLoader(details, width, theme);
			const tree = expanded ? extractTree(details, width, theme) : "";
			const ids = expanded
				? toolResultId([{ label: "responseId", id: details?.responseId ?? "" }], theme)
				: [];
			return [loader, body, tree, ids.length > 0 ? ids.join("\n") : ""]
				.filter(Boolean)
				.join("\n\n");
		},
		padToWidth: true,
		markdownPreview: hasLongMarkdown
			? () => new Markdown(preview.slice(0, 800), 0, 0, toolMarkdownTheme(theme))
			: undefined,
	});
}

function extractSummary(
	details: Partial<ToolContext<unknown>> | undefined,
	theme?: RenderTheme,
): string {
	if (details?.summary) return details.summary;
	const numericStatus = typeof details?.status === "number" ? details.status : undefined;
	return toolStatus(
		[
			numericStatus !== undefined
				? `${toolStatusDot(numericStatus, theme)} ${numericStatus}`
				: details?.status
					? String(details.status)
					: "done",
			details?.finalUrl ?? details?.url,
			details?.responseId ? `responseId: ${details.responseId}` : undefined,
			details?.freshness?.stale ? "stale" : undefined,
		],
		theme,
	);
}

function extractLoader(
	details: Partial<ToolContext<unknown>> | undefined,
	width: number,
	theme?: RenderTheme,
): string {
	const url = details?.finalUrl ?? details?.url;
	if (!url) return "";
	return toolResourceStatus({
		url,
		state: details?.error ? "error" : "done",
		width,
		theme,
		restoreBg: details?.error ? "toolErrorBg" : "toolSuccessBg",
	});
}

function extractTree(
	details: Partial<ToolContext<unknown>> | undefined,
	width: number,
	theme?: RenderTheme,
): string {
	if (!details) return "";
	const sections = buildExpandedResultDetails(details as Record<string, unknown>);
	return sections.length > 0 ? toolResultTree(sections, width, theme) : "";
}

function expandedExtractText(
	summary: string,
	preview: string,
	details: Partial<ToolContext<unknown>> | undefined,
): string {
	const extras: string[] = [];
	if (details?.freshness?.stale) extras.push("freshness: stale; refresh if time-sensitive");
	const u = details?.modelUsage;
	if (u) {
		const cost =
			typeof u.costUSD === "number"
				? u.costUSD === 0
					? "$0"
					: u.costUSD < 0.0001
						? `~$${u.costUSD.toExponential(1)}`
						: `$${u.costUSD.toFixed(u.costUSD < 1 ? 4 : 2)}`
				: undefined;
		const parts = [
			u.provider,
			u.model,
			typeof u.inputTokens === "number" ? `${u.inputTokens} in` : undefined,
			typeof u.outputTokens === "number" ? `${u.outputTokens} out` : undefined,
			typeof u.totalTokens === "number" ? `${u.totalTokens} total` : undefined,
			cost,
		].filter(Boolean);
		if (parts.length > 0) extras.push(`model usage: ${parts.join(" · ")}`);
	}
	const extra = extras.length > 0 ? `${extras.join("\n")}\n` : "";
	const previewBlock = (details?.answerContext ?? preview).slice(0, 500);
	const next = details?.nextActions
		?.slice(0, 3)
		.map((a) => `- ${a.action}${a.tool ? ` via ${a.tool}` : ""}: ${a.description}`)
		.join("\n");
	return [summary, extra, previewBlock, next ? `\nNext actions:\n${next}` : ""]
		.filter(Boolean)
		.join("\n");
}
