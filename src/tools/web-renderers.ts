/**
 * @fileoverview Renderers for Pi web tool calls and results.
 */
import type { PiToolShell, ProgressDetails, ResultEnvelope } from "../types.js";
import type {
	RenderComponent,
	RenderTheme,
	ToolRenderContext,
} from "./define.js";
import { renderText } from "./render.js";
import {
	accent,
	activityCountSegment,
	currentSpinnerFrame,
	errorTitle,
	failureCountSegment,
	formatChecklistItem,
	formatChecklistText,
	isProgress,
	metadataText,
	neutralText,
	previewText,
	progressPillLabel,
	progressPillState,
	progressStartedAtMs,
	renderStatusGlyph,
	renderStatusPill,
	renderUrlStatusRow,
	separator,
	successCountSegment,
} from "./shared-renderers.js";
import {
	batchExpandedDetails,
	batchProgressFromCrawlPages,
	batchProgressFromItems,
	crawlExpandedDetails,
	isBatchProgress,
	isBatchProgressView,
	renderBatchProgressCard,
	renderBatchResultCard,
	renderMapResultCard,
} from "./web-batch-progress-renderer.js";
import { renderScrapeResultCard } from "./web-scrape-result-renderer.js";
import type {
	BatchItem,
	CrawlMeta,
	CrawlPageView,
	DiffData,
} from "./web-renderer-types.js";

export type ChecklistState = "done" | "pending" | "failed" | "warning" | "info";

export interface ChecklistItem {
	label: string;
	state: ChecklistState;
	detail?: string;
}

export function renderWebToolCall(
	name: `web_${string}`,
	parts: Array<string | undefined>,
	theme?: RenderTheme,
	_context?: ToolRenderContext,
	_options: { donePrefix?: string | false; animate?: boolean } = {},
): RenderComponent {
	const label = `${name} ${parts.filter(Boolean).join(" ")}`.trim();
	return renderText(accent(label, theme));
}

export function renderWebScrapeResult(
	result: PiToolShell,
	expanded = false,
	theme?: RenderTheme,
): RenderComponent {
	const details = result.details as
		| Partial<ResultEnvelope<unknown>>
		| ProgressDetails;
	if (isProgress(details))
		return renderScrapeProgressCard(details, expanded, theme);
	const envelope = details as Partial<ResultEnvelope<Record<string, unknown>>>;
	const summary = envelope.error
		? errorTitle("web_scrape", envelope.error)
		: [
				envelope.status ?? "ok",
				envelope.mode,
				envelope.format,
				cacheLabel(envelope) ?? "fresh fetch",
				freshnessLabel(envelope),
				!expanded ? metadataText("(ctrl+o to expand)", theme) : undefined,
			]
				.filter(Boolean)
				.join(theme ? separator(theme) : " · ");
	return renderScrapeResultCard(
		envelope,
		{
			expanded,
			summary,
			notice: sessionNotice(envelope),
			preview: previewText(result, envelope),
			responseId: envelope.responseId,
		},
		theme,
	);
}

function renderScrapeProgressCard(
	details: ProgressDetails,
	expanded: boolean,
	theme?: RenderTheme,
): RenderComponent {
	const url = details.url ?? "unknown URL";
	const failed = details.state === "error";
	const status = failed
		? "error"
		: details.state === "done"
			? "done"
			: "loading";
	const startedAtMs = progressStartedAtMs(details) ?? Date.now();
	return {
		render(width: number) {
			const row = renderUrlStatusRow({
				url,
				label: status,
				state: status,
				width,
				theme,
				startedAtMs,
			});
			const summary = `web_scrape ${details.state}${
				theme ? separator(theme) : " · "
			}${metadataText("(ctrl+o to expand)", theme)}`;
			const lines = [row, "", summary];
			if (expanded && details.checklist?.length) {
				lines.push(
					"",
					...details.checklist.map((item) =>
						formatChecklistText({
							label: item.label,
							detail: item.detail,
						}),
					),
				);
			}
			if (details.state !== "done" && details.state !== "error") {
				const frame = currentSpinnerFrame();
				const text = [...lines, "", `${frame} Working...`].join("\n");
				return renderText(text, { padToWidth: true }).render(width);
			}
			return renderText(lines.join("\n"), { padToWidth: true }).render(width);
		},
		invalidate() {},
	};
}

export function renderWebCrawlResult(
	result: PiToolShell,
	expanded = false,
	theme?: RenderTheme,
): RenderComponent {
	const details = result.details as
		| Partial<ResultEnvelope<unknown>>
		| ProgressDetails;
	if (isProgress(details)) {
		if (isBatchProgress(details))
			return renderBatchProgressCard(details, expanded, theme);
		return renderProgress("web_crawl", details, theme);
	}
	const envelope = details as Partial<
		ResultEnvelope<{ metadata?: CrawlMeta; pages?: unknown[] }>
	>;
	const metadata = envelope.data?.metadata;
	const failed = metadata?.failedCount ?? 0;
	const summary = envelope.error
		? errorTitle("web_crawl", envelope.error)
		: [
				successCountSegment(metadata?.succeededCount ?? 0, "succeeded", theme),
				failureCountSegment(failed, "failed", theme),
				activityCountSegment(
					metadata?.visitedCount ?? 0,
					"visited",
					"◉",
					theme,
				),
				neutralText(`→ frontier ${metadata?.frontierCount ?? 0}`, theme),
				!expanded ? metadataText("(ctrl+o to expand)", theme) : undefined,
			]
				.filter(Boolean)
				.join(separator(theme));
	const pages = Array.isArray(envelope.data?.pages)
		? (envelope.data?.pages as CrawlPageView[])
		: [];
	const progress = isBatchProgressView(envelope.diagnostics?.batchProgress)
		? envelope.diagnostics.batchProgress
		: batchProgressFromCrawlPages(pages);
	return renderBatchResultCard(
		{
			progress,
			summary,
			notice: sessionNotice(envelope),
			preview: crawlExpandedDetails(pages, {
				jobId: envelope.diagnostics?.jobId,
				packageResponseId: contextPackageResponseId(envelope),
			}),
			responseId: envelope.responseId,
		},
		expanded,
		theme,
	);
}

export function renderWebMapResult(
	result: PiToolShell,
	expanded = false,
	theme?: RenderTheme,
): RenderComponent {
	const details = result.details as Partial<ResultEnvelope<unknown>>;
	if (isProgress(details as unknown))
		return renderProgress("web_map", details as ProgressDetails, theme);
	const envelope = details as Partial<
		ResultEnvelope<{
			urls?: { url: string; source?: string; title?: string }[];
		}>
	>;
	const urls = Array.isArray(envelope.data?.urls) ? envelope.data!.urls : [];
	const summary = [
		theme?.bold?.("web_map") ?? "web_map",
		`${urls.length} URL(s)`,
		!expanded ? metadataText("(ctrl+o to expand)", theme) : undefined,
	]
		.filter(Boolean)
		.join(theme ? separator(theme) : " · ");
	if (urls.length === 0) {
		return renderText(
			`${summary}\n\n${metadataText("No URLs discovered.", theme)}`,
			{
				padToWidth: true,
			},
		);
	}
	return {
		render(width: number) {
			const mapCard = renderMapResultCard(urls, expanded, theme);
			const mapText = mapCard.render(width).join("\n");
			const lines = [summary, mapText];
			if (expanded && envelope.responseId)
				lines.push(
					"",
					metadataText(`responseId: ${envelope.responseId}`, theme),
				);
			return renderText(lines.join("\n"), { padToWidth: true }).render(width);
		},
		invalidate() {},
	};
}

export function renderWebBatchResult(
	result: PiToolShell,
	expanded = false,
	theme?: RenderTheme,
): RenderComponent {
	const details = result.details as
		| Partial<ResultEnvelope<unknown>>
		| ProgressDetails;
	if (isProgress(details)) {
		if (isBatchProgress(details))
			return renderBatchProgressCard(details, expanded, theme);
		return renderProgress("web_batch", details, theme);
	}
	const envelope = details as Partial<ResultEnvelope<BatchItem[]>>;
	const items = Array.isArray(envelope.data) ? envelope.data : [];
	const succeeded = items.filter((item) => item.ok === true).length;
	const failed = items.length - succeeded;
	const cacheHits = items.filter(
		(item) => item.ok === true && item.result?.cache?.cached,
	).length;
	const summary = envelope.error
		? errorTitle("web_batch", envelope.error)
		: [
				successCountSegment(succeeded, "succeeded", theme),
				failureCountSegment(failed, "failed", theme),
				activityCountSegment(cacheHits, "cache hits", "ⓞ", theme),
				freshnessLabel(envelope),
				!expanded ? metadataText("(ctrl+o to expand)", theme) : undefined,
			]
				.filter(Boolean)
				.join(separator(theme));
	const progressValue = envelope.diagnostics?.batchProgress;
	const progress = isBatchProgressView(progressValue)
		? progressValue
		: batchProgressFromItems(items);
	return renderBatchResultCard(
		{
			progress,
			summary,
			notice: sessionNotice(envelope),
			preview: batchExpandedDetails(items, {
				jobId: envelope.diagnostics?.jobId,
				packageResponseId: contextPackageResponseId(envelope),
			}),
			responseId: envelope.responseId,
			padToWidth: false,
		},
		expanded,
		theme,
	);
}

export function renderWebDiffResult(
	result: PiToolShell,
	expanded = false,
	theme?: RenderTheme,
): RenderComponent {
	const details = result.details as
		| Partial<ResultEnvelope<unknown>>
		| ProgressDetails;
	if (isProgress(details)) return renderProgress("web_diff", details, theme);
	const envelope = details as Partial<ResultEnvelope<DiffData>>;
	const diff = envelope.data;
	const title = envelope.error
		? errorTitle("web_diff", envelope.error)
		: [diffTitle(diff, envelope.summary), freshnessLabel(envelope)]
				.filter(Boolean)
				.join(separator());
	return renderChecklistResult(title, expanded, {
		items: [
			{ label: "fetched current page", state: diff?.current ? "done" : "info" },
			{
				label: "loaded previous snapshot",
				state: diff?.previous ? "done" : "warning",
			},
			{ label: "compared normalized content", state: diff ? "done" : "info" },
			{ label: "saved snapshot", state: envelope.responseId ? "done" : "info" },
		],
		preview: envelope.answerContext ?? result.content[0]?.text,
		responseId: envelope.responseId,
		icons: false,
	});
}

function renderChecklistResult(
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

function toolAllowsIcons(toolName: `web_${string}`): boolean {
	return toolName === "web_batch" || toolName === "web_crawl";
}

function renderProgress(
	toolName: `web_${string}`,
	details: ProgressDetails,
	theme?: RenderTheme,
): RenderComponent {
	const startedAtMs = progressStartedAtMs(details) ?? Date.now();
	return {
		render(width: number) {
			const statusWidth = Math.max(12, Math.min(18, Math.floor(width * 0.22)));
			const state = progressPillState(details.state);
			const count = details.total
				? ` ${details.current ?? 0}/${details.total}`
				: "";
			const message = details.message ? ` · ${details.message}` : "";
			const url = details.url ? ` · ${details.url}` : "";
			const icons = toolAllowsIcons(toolName);
			const glyph = renderStatusGlyph(state, theme);
			const pill = renderStatusPill({
				label: progressPillLabel(details.state),
				state,
				width: statusWidth,
				theme,
				startedAtMs,
			});
			const lines = [
				`${glyph} ${toolName} ${details.state}${count}${url}${message} ${pill}`,
			];
			if (details.checklist?.length) {
				const formatter = icons ? formatChecklistItem : formatChecklistText;
				lines.push(...details.checklist.map(formatter));
			}
			if (details.counts) {
				const counts = details.counts;
				lines.push(
					[
						counts.succeeded === undefined
							? undefined
							: icons
								? successCountSegment(counts.succeeded, "succeeded", theme)
								: `${counts.succeeded} succeeded`,
						counts.failed === undefined
							? undefined
							: icons
								? failureCountSegment(counts.failed, "failed", theme)
								: `${counts.failed} failed`,
						counts.cacheHits === undefined
							? undefined
							: icons
								? activityCountSegment(
										counts.cacheHits,
										"cache hits",
										"ⓞ",
										theme,
									)
								: `${counts.cacheHits} cache hits`,
					]
						.filter(Boolean)
						.join(" · "),
				);
			}
			return renderText(lines.filter(Boolean).join("\n"), {
				padToWidth: true,
			}).render(width);
		},
		invalidate() {},
	};
}

function cacheLabel(
	envelope: Partial<ResultEnvelope<unknown>>,
): string | undefined {
	if (!envelope.cache?.cached) return undefined;
	return `↻ cache hit${envelope.cache.staleness ? ` ${envelope.cache.staleness}` : ""}`;
}

function freshnessLabel(
	envelope: Partial<ResultEnvelope<unknown>>,
): string | undefined {
	return envelope.freshness?.stale ? "⚠ stale" : undefined;
}

function sessionNotice(
	envelope: Partial<ResultEnvelope<unknown>>,
): string | undefined {
	const notice = envelope.diagnostics?.sessionNotice;
	return typeof notice === "string" ? notice : undefined;
}

function contextPackageResponseId(
	envelope: Partial<ResultEnvelope<unknown>>,
): string | undefined {
	const value = envelope.diagnostics?.contextPackage;
	if (typeof value !== "object" || value === null) return undefined;
	const responseId = (value as { responseId?: unknown }).responseId;
	return typeof responseId === "string" ? responseId : undefined;
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
