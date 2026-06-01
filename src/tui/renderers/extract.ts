import { Markdown } from "@earendil-works/pi-tui";

import { isProgress, type PiToolShell, type ToolContext } from "../../types.ts";
import { toolProgressView, toolProgressLayout } from "../tool-progress.ts";
import { toolResource } from "../tool-resource.ts";
import { toolResultTree } from "../tool-result-tree.ts";
import { buildToolResultDetails } from "../tool-result.ts";
import { toolStatusDot, toolStatus } from "../tool-status.ts";
import { getMarkdownTheme as toolMarkdownTheme } from "../tui.ts";
import type { RenderComponent, RenderTheme } from "../types.ts";

export function renderWebExtractResult(
	result: PiToolShell,
	expanded = false,
	theme?: RenderTheme,
): RenderComponent {
	const details = result.details as Partial<ToolContext<unknown>> | undefined;
	if (isProgress(details)) return toolProgressView("web_extract", details, theme);
	const preview = result.content[0]?.text ?? "";
	const numericStatus = typeof details?.status === "number" ? details.status : undefined;
	const summary =
		details?.summary ??
		toolStatus(
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
	const nextActions = details?.nextActions
		?.slice(0, 3)
		.map((a) => `- ${a.action}${a.tool ? ` via ${a.tool}` : ""}: ${a.description}`)
		.join("\n");
	const body = expanded
		? [summary, extra, previewBlock, nextActions ? `\nNext actions:\n${nextActions}` : ""]
				.filter(Boolean)
				.join("\n")
		: summary;
	const hasLongMarkdown = expanded && details?.format === "markdown" && preview.length > 100;
	const hideExpandedDetails = details?.summary === "Listed deterministic extractor capabilities.";
	return toolProgressLayout({
		renderContent() {
			const loaderUrl = details?.finalUrl ?? details?.url;
			const loader = loaderUrl
				? toolResource({
						url: loaderUrl,
						state: details?.error ? "error" : "done",
						theme,
					})
				: "";
			return [loader, body].filter(Boolean).join("\n\n");
		},
		expanded,
		expandedSections: (width) =>
			details && !hideExpandedDetails
				? [toolResultTree(buildToolResultDetails(details as Record<string, unknown>), width, theme)]
				: [],
		responseId: details?.responseId,
		padToWidth: true,
		markdownPreview: hasLongMarkdown
			? () => new Markdown(preview.slice(0, 800), 0, 0, toolMarkdownTheme(theme))
			: undefined,
	});
}
