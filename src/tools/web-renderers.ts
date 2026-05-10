/**
 * @fileoverview Thin dispatch surface for Pi web tool result renderers.
 *
 * Tool-specific composition lives in focused modules:
 * - web-scrape-renderers.ts
 * - web-crawl-renderers.ts (crawl uses batch progress cards)
 * - web-map-renderers.ts
 * - web-batch-renderers.ts
 * - web-diff-renderers.ts
 * - web-progress-renderers.ts
 */
import {
	isProgress,
	type PiToolShell,
	type ProgressDetails,
	type ResultEnvelope,
} from "../types.ts";
import type { RenderComponent, RenderTheme } from "../tui/types.ts";
import { renderText } from "./render.ts";

import { renderProgress } from "../tui/progress-card.ts";
import {
	batchExpandedDetails,
	renderBatchProgressCard,
	renderBatchResultCard,
} from "./web-batch-renderers.ts";
import { crawlExpandedDetails } from "./web-crawl-renderers.ts";
import { renderMapResultCard } from "./web-map-renderers.ts";
import { batchProgressFromCrawlPages } from "./web-batch-progress.ts";
import {
	batchProgressFromItems,
	isBatchProgress,
	isBatchProgressView,
} from "../batch/progress-state.ts";
import type { CrawlMeta, CrawlPageView } from "./web-renderer-views.ts";
import {
	activityCountSegment,
	failureCountSegment,
	successCountSegment,
} from "../tui/counts.ts";
import { metadataText, neutralText, separator } from "../tui/theme.ts";
import {
	errorTitle,
	freshnessLabel,
	sessionNotice,
	contextPackageResponseId,
} from "../tui/envelope-labels.ts";
import { toolAllowsIcons } from "./web-renderer-helpers.ts";

export { renderWebScrapeResult } from "./web-scrape-renderers.ts";
export {
	renderWebDiffResult,
	renderChecklistResult,
} from "./web-diff-renderers.ts";
export { renderProgress } from "../tui/progress-card.ts";

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
		return renderProgress("web_crawl", details, theme, {
			allowIcons: toolAllowsIcons("web_crawl"),
		});
	}
	const envelope = details as Partial<
		ResultEnvelope<{ metadata?: CrawlMeta; pages?: unknown[] }>
	>;
	const metadata = envelope.data?.metadata;
	const failed = metadata?.failedCount ?? 0;
	const summary = envelope.error
		? errorTitle("web_crawl", envelope.error, { allowIcons: true })
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
	const details = result.details as
		| Partial<ResultEnvelope<unknown>>
		| ProgressDetails;
	if (isProgress(details))
		return renderProgress("web_map", details, theme, {
			allowIcons: toolAllowsIcons("web_map"),
		});
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
		return renderProgress("web_batch", details, theme, {
			allowIcons: toolAllowsIcons("web_batch"),
		});
	}
	const envelope = details as Partial<
		ResultEnvelope<import("../batch/run.ts").BatchItemResult[]>
	>;
	const items = Array.isArray(envelope.data) ? envelope.data : [];
	const succeeded = items.filter((item) => item.ok === true).length;
	const failed = items.length - succeeded;
	const cacheHits = items.filter(
		(item) => item.ok === true && item.result?.cache?.cached,
	).length;
	const summary = envelope.error
		? errorTitle("web_batch", envelope.error, { allowIcons: true })
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
