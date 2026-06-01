import type { PiToolShell } from "../../types.ts";
import { activity, failure, muted, success } from "../theme.ts";
import { renderDynamicText } from "../tool-call.ts";
import {
	buildToolResultTree,
	splitValueByWidth,
	toolResultTree,
	type ToolResultGroup,
} from "../tool-result-tree.ts";
import { buildExpandedResultDetails } from "../tool-result.ts";
import type { RenderComponent, RenderTheme } from "../types.ts";

type BrowserFallback = { used: boolean; backend: string };
type VerticalComment = { author?: string; text?: string };
type TranscriptSegment = { text: string; start: number; duration?: number };
type TranscriptPreview = { segments?: TranscriptSegment[]; text?: string };
type BlockedSource = { reason?: string; attemptedEndpoints?: string[] };

export function renderVerticalResult(
	result: PiToolShell,
	expanded: boolean | undefined,
	theme?: RenderTheme,
): RenderComponent {
	const details = result.details as Record<string, unknown> | undefined;
	const wrapper = details?.data as Record<string, unknown> | undefined;
	const name = typeof wrapper?.extractor === "string" ? wrapper.extractor : "extractor";

	if (wrapper?.error ?? details?.error) {
		const error = (wrapper?.error ?? details?.error) as { code?: string } | undefined;
		return renderDynamicText(
			() =>
				`\u2514\u2500 ${failure("\u2715", theme)} ${name} failed${muted(` \u00B7 ${error?.code ?? "FAILED"}`, theme)}`,
			{ padToWidth: true },
		);
	}

	const data = wrapper?.data as Record<string, unknown> | undefined;
	const blocked = (data as { source?: BlockedSource & { blocked?: boolean } } | undefined)?.source;
	if (blocked?.blocked) return renderBlockedVerticalResult(name, data, blocked, expanded, theme);
	const browserFallback = wrapper?.browserFallback as BrowserFallback | undefined;
	const treeLine = () => {
		const summaryDetails = [
			extractorPreview(data),
			browserFallback?.used ? `browser fallback · ${browserFallback.backend}` : undefined,
		]
			.filter(Boolean)
			.join(" \u00B7 ");
		return `${success("\u2713", theme)} ${name} done${muted(` \u00B7 ${summaryDetails}`, theme)}`;
	};

	if (!expanded || !data) return renderDynamicText(treeLine, { padToWidth: true });

	return renderDynamicText(
		() => {
			const sections = buildToolResultTree(buildVerticalSections(data, browserFallback));
			const transcriptBlock = formatTranscriptBlock(
				data.transcript as TranscriptPreview | undefined,
				80,
				theme,
			);
			const commentsBlock = formatCommentsBlock(
				data.comments as VerticalComment[] | undefined,
				80,
				theme,
			);
			const sourceSections = buildToolResultTree(buildSourceSections(data));
			const hasVerticalBlocks = transcriptBlock || commentsBlock || sourceSections.length > 0;
			if (sections.every((section) => section.name === "extraction") && !hasVerticalBlocks)
				sections.push(
					...buildExpandedResultDetails(data, {
						hide: new Set<string>(),
						sectionName: "data",
					}),
				);
			const body = toolResultTree(sections, 80, theme);
			const sourceBlock = toolResultTree(sourceSections, 80, theme);
			return [treeLine(), transcriptBlock, body, commentsBlock, sourceBlock]
				.filter(Boolean)
				.join("\n\n");
		},
		{ padToWidth: true },
	);
}

function buildVerticalSections(
	data: Record<string, unknown>,
	browserFallback?: BrowserFallback,
): ToolResultGroup[] {
	const sections: ToolResultGroup[] = [];
	if (browserFallback?.used) {
		sections.push({
			name: "extraction",
			rows: [
				["path", "browser-prerender \u2192 vertical"],
				["browserBackend", browserFallback.backend],
			],
		});
	}

	const videoRows: ToolResultGroup["rows"] = [];
	if (typeof data.title === "string" && data.title) videoRows.push(["title", data.title]);
	if (typeof data.channel === "string" && data.channel) videoRows.push(["channel", data.channel]);
	if (typeof data.views === "number" && data.views > 0)
		videoRows.push(["views", data.views.toLocaleString()]);
	if (typeof data.lengthSeconds === "number") {
		const m = Math.floor(data.lengthSeconds / 60);
		videoRows.push(["duration", `${m}:${(data.lengthSeconds % 60).toString().padStart(2, "0")}`]);
	}
	sections.push({ name: "video", rows: videoRows });
	return sections;
}

function buildSourceSections(
	data: Record<string, unknown>,
	options: { includeEndpoint?: boolean } = {},
): ToolResultGroup[] {
	const source = data.source as
		| { provider?: string; videoUrl?: string; endpoint?: string }
		| undefined;
	const sourceRows: ToolResultGroup["rows"] = [];
	if (source?.provider) sourceRows.push(["provider", source.provider]);
	if (source?.videoUrl) sourceRows.push(["url", source.videoUrl]);
	if (options.includeEndpoint !== false && source?.endpoint)
		sourceRows.push(["endpoint", source.endpoint]);
	if (typeof data.permalink === "string") sourceRows.push(["url", data.permalink]);
	return sourceRows.length > 0 ? [{ name: "source", rows: sourceRows }] : [];
}

function renderBlockedVerticalResult(
	name: string,
	data: Record<string, unknown> | undefined,
	blocked: BlockedSource,
	expanded: boolean | undefined,
	theme?: RenderTheme,
): RenderComponent {
	const reason = blocked.reason ?? "structured endpoint unavailable";
	const treeLine = () =>
		`${activity("!", theme)} ${name} metadata only${muted(` \u00B7 ${summarizeBlockedReason(reason)}`, theme)}`;
	if (!expanded) return renderDynamicText(treeLine, { padToWidth: true });
	return renderDynamicText(
		() => {
			const attemptedBlock = formatListBlock(
				"attempted endpoints",
				[...new Set(blocked.attemptedEndpoints ?? [])],
				80,
				theme,
			);
			const sourceBlock = data
				? toolResultTree(
						buildToolResultTree(buildSourceSections(data, { includeEndpoint: false })),
						80,
						theme,
					)
				: "";
			return [treeLine(), attemptedBlock, sourceBlock].filter(Boolean).join("\n\n");
		},
		{ padToWidth: true },
	);
}

function summarizeBlockedReason(reason: string): string {
	if (/robots\.txt|robots/iu.test(reason)) return "blocked by robots.txt";
	return reason.length > 80 ? `${reason.slice(0, 77)}…` : reason;
}

function formatTranscriptBlock(
	transcript: TranscriptPreview | undefined,
	width: number,
	theme?: RenderTheme,
): string {
	const segments = transcript?.segments ?? [];
	if (segments.length === 0) return "";
	const preview = segments.slice(0, 20);
	const timestamps = preview.map((segment) => formatTimestamp(segment.start));
	const timeWidth = Math.max(4, ...timestamps.map((time) => time.length));
	const availableWidth = Math.max(20, width - 2 - 3 - timeWidth - 2);
	const lines = ["  transcript"];
	const hasMore = segments.length > preview.length;
	for (let i = 0; i < preview.length; i++) {
		const isLast = !hasMore && i === preview.length - 1;
		const connector = isLast ? "\u2514\u2500 " : "\u251C\u2500 ";
		const time = timestamps[i]?.padStart(timeWidth) ?? "".padStart(timeWidth);
		const text = (preview[i]?.text ?? "").replaceAll(/\s+/gu, " ").trim();
		const textLines = splitValueByWidth(text, availableWidth);
		lines.push(`  ${muted(`${connector}${time}  `, theme)}${textLines[0] ?? ""}`);
		const continuationPrefix = (isLast ? "  " : "\u2502 ").padEnd(3 + timeWidth + 2);
		for (const line of textLines.slice(1))
			lines.push(`  ${muted(continuationPrefix, theme)}${line}`);
	}
	if (hasMore)
		lines.push(
			`  ${muted(`\u2514\u2500 ${"…".padStart(timeWidth)}  `, theme)}${segments.length - preview.length} more segments`,
		);
	return lines.join("\n");
}

function formatCommentsBlock(
	comments: VerticalComment[] | undefined,
	width: number,
	theme?: RenderTheme,
): string {
	if (!comments?.length) return "";
	const preview = comments.slice(0, 5);
	const lines = ["  comments"];
	const hasMore = comments.length > preview.length;
	for (const [i, comment] of preview.entries()) {
		const isLast = !hasMore && i === preview.length - 1;
		const connector = isLast ? "\u2514\u2500 " : "\u251C\u2500 ";
		const text = (comment.text ?? "").replaceAll(/\s+/gu, " ").trim();
		const value = `${comment.author ? `${comment.author}: ` : `${i + 1}. `}${text.length > 180 ? `${text.slice(0, 180)}…` : text}`;
		const valueLines = splitValueByWidth(value, Math.max(20, width - 2 - 3));
		lines.push(`  ${muted(connector, theme)}${valueLines[0] ?? ""}`);
		for (const line of valueLines.slice(1))
			lines.push(`  ${muted(isLast ? "   " : "\u2502  ", theme)}${line}`);
	}
	if (hasMore)
		lines.push(
			`  ${muted("\u2514\u2500 … ", theme)}${comments.length - preview.length} more comments`,
		);
	return lines.join("\n");
}

function formatListBlock(
	name: string,
	items: string[],
	width: number,
	theme?: RenderTheme,
): string {
	if (items.length === 0) return "";
	const lines = [`  ${name}`];
	for (let i = 0; i < items.length; i++) {
		const connector = i === items.length - 1 ? "\u2514\u2500 " : "\u251C\u2500 ";
		const valueLines = splitValueByWidth(items[i] ?? "", Math.max(20, width - 2 - 3));
		lines.push(`  ${muted(connector, theme)}${valueLines[0] ?? ""}`);
		for (const line of valueLines.slice(1))
			lines.push(`  ${muted(i === items.length - 1 ? "   " : "\u2502  ", theme)}${line}`);
	}
	return lines.join("\n");
}

function formatTimestamp(seconds: number): string {
	const totalSeconds = Math.max(0, Math.floor(seconds));
	return `${Math.floor(totalSeconds / 60)}:${(totalSeconds % 60).toString().padStart(2, "0")}`;
}

function extractorPreview(data: unknown): string {
	const d = data as Record<string, unknown> | undefined;
	if (!d) return "extracted JSON";
	const trans = d.transcript as { text?: string; segments?: unknown[] } | undefined;
	return (
		[
			typeof d.title === "string" && d.title ? d.title : undefined,
			typeof d.views === "number" && d.views > 0
				? `${(d.views / 1000000).toFixed(d.views >= 100000000 ? 0 : 1)}M views`
				: typeof d.views === "string" && d.views
					? `${d.views} views`
					: undefined,
			trans?.segments ? `${trans.segments.length} segments` : undefined,
			!trans?.text && typeof d.description === "string" && d.description
				? `${d.description.replaceAll(/\s+/gu, " ").trim().slice(0, 120)}${d.description.length > 120 ? "\u2026" : ""}`
				: undefined,
			Array.isArray(d.comments) && d.comments.length > 0
				? `${d.comments.length} comments`
				: undefined,
			Array.isArray(d.transcriptTracks) && d.transcriptTracks.length > 1
				? `${d.transcriptTracks.length} languages`
				: undefined,
		]
			.filter(Boolean)
			.join(" \u00B7 ") || "extracted JSON"
	);
}
