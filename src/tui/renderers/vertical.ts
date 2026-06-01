import type { PiToolShell } from "../../types.ts";
import { buildToolResultTree, splitValueByWidth, toolResultTree } from "../tool-result-tree.ts";
import type { ToolResultGroup } from "../tool-result-tree.ts";
import { buildToolResultDetails } from "../tool-result.ts";
import { activity, failure, muted, renderDynamicText, success } from "../tui.ts";
import type { RenderComponent, RenderTheme } from "../types.ts";

type VerticalData = Record<string, unknown>;
type BrowserFallback = { used: boolean; backend: string };
type VerticalComment = { author?: string; text?: string };
type TranscriptSegment = { text: string; start: number; duration?: number };
type TranscriptPreview = { segments?: TranscriptSegment[]; text?: string };
type BlockedSource = { reason?: string; attemptedEndpoints?: string[] };
type SourceInfo = { provider?: string; videoUrl?: string; endpoint?: string };

const renderVerticalText = (buildText: () => string): RenderComponent =>
	renderDynamicText(buildText, { padToWidth: true });

export function renderVerticalResult(
	result: PiToolShell,
	expanded: boolean | undefined,
	theme?: RenderTheme,
): RenderComponent {
	const details = result.details as VerticalData | undefined;
	const wrapper = details?.data as VerticalData | undefined;
	const name = typeof wrapper?.extractor === "string" ? wrapper.extractor : "extractor";

	const error = (wrapper?.error ?? details?.error) as { code?: string } | undefined;
	if (error)
		return renderVerticalText(
			() =>
				`\u2514\u2500 ${failure("\u2715", theme)} ${name} failed${muted(` \u00B7 ${error.code ?? "FAILED"}`, theme)}`,
		);

	const data = wrapper?.data as VerticalData | undefined;
	const blocked = (data as { source?: BlockedSource & { blocked?: boolean } } | undefined)?.source;
	if (blocked?.blocked) return renderBlockedVerticalResult(name, data, blocked, expanded, theme);
	const browser = wrapper?.browserFallback as BrowserFallback | undefined;
	const fallback = browser?.used ? ` \u00B7 browser fallback \u00B7 ${browser.backend}` : "";
	const treeLine = () =>
		`${success("\u2713", theme)} ${name} done${muted(` \u00B7 ${extractorPreview(data)}${fallback}`, theme)}`;

	if (!expanded || !data) return renderVerticalText(treeLine);

	return renderVerticalText(() => {
		const sections = buildToolResultTree(buildVerticalSections(data, browser));
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
				...buildToolResultDetails(data, {
					hide: new Set<string>(),
					sectionName: "data",
				}),
			);
		const body = toolResultTree(sections, 80, theme);
		const sourceBlock = toolResultTree(sourceSections, 80, theme);
		return [treeLine(), transcriptBlock, body, commentsBlock, sourceBlock]
			.filter(Boolean)
			.join("\n\n");
	});
}

function buildVerticalSections(
	data: VerticalData,
	browserFallback?: BrowserFallback,
): ToolResultGroup[] {
	const sections: ToolResultGroup[] = [];
	if (browserFallback?.used)
		sections.push({
			name: "extraction",
			rows: [
				["path", "browser-prerender \u2192 vertical"],
				["browserBackend", browserFallback.backend],
			],
		});

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

function buildSourceSections(data: VerticalData, includeEndpoint = true): ToolResultGroup[] {
	const source = data.source as SourceInfo | undefined;
	const sourceRows: ToolResultGroup["rows"] = [];
	if (source?.provider) sourceRows.push(["provider", source.provider]);
	if (source?.videoUrl) sourceRows.push(["url", source.videoUrl]);
	if (includeEndpoint && source?.endpoint) sourceRows.push(["endpoint", source.endpoint]);
	if (typeof data.permalink === "string") sourceRows.push(["url", data.permalink]);
	return [{ name: "source", rows: sourceRows }];
}

function renderBlockedVerticalResult(
	name: string,
	data: VerticalData | undefined,
	blocked: BlockedSource,
	expanded: boolean | undefined,
	theme?: RenderTheme,
): RenderComponent {
	const treeLine = () =>
		`${activity("!", theme)} ${name} metadata only${muted(` \u00B7 ${summarizeBlockedReason(blocked.reason ?? "structured endpoint unavailable")}`, theme)}`;
	if (!expanded) return renderVerticalText(treeLine);
	return renderVerticalText(() => {
		const attemptedBlock = formatListBlock(
			"attempted endpoints",
			[...new Set(blocked.attemptedEndpoints ?? [])],
			80,
			theme,
		);
		const sourceBlock = toolResultTree(
			buildToolResultTree(buildSourceSections(data ?? {}, false)),
			80,
			theme,
		);
		return [treeLine(), attemptedBlock, sourceBlock].filter(Boolean).join("\n\n");
	});
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
	const lines = ["  transcript"];
	for (let i = 0; i < preview.length; i++) {
		const isLast = segments.length <= 20 && i === preview.length - 1;
		const connector = isLast ? "\u2514\u2500 " : "\u251C\u2500 ";
		const time = timestamps[i]?.padStart(timeWidth) ?? "".padStart(timeWidth);
		const text = (preview[i]?.text ?? "").replaceAll(/\s+/gu, " ").trim();
		const textLines = splitValueByWidth(text, Math.max(20, width - 2 - 3 - timeWidth - 2));
		lines.push(`  ${muted(`${connector}${time}  `, theme)}${textLines[0] ?? ""}`);
		for (const line of textLines.slice(1))
			lines.push(`  ${muted((isLast ? "  " : "\u2502 ").padEnd(3 + timeWidth + 2), theme)}${line}`);
	}
	if (segments.length > 20)
		lines.push(
			`  ${muted(`\u2514\u2500 ${"…".padStart(timeWidth)}  `, theme)}${segments.length - 20} more segments`,
		);
	return lines.join("\n");
}

function formatCommentsBlock(
	comments: VerticalComment[] | undefined,
	width: number,
	theme?: RenderTheme,
): string {
	if (!comments?.length) return "";
	const preview = comments.slice(0, 5).map((comment, i) => {
		const text = (comment.text ?? "").replaceAll(/\s+/gu, " ").trim();
		return `${comment.author ? `${comment.author}: ` : `${i + 1}. `}${text.length > 180 ? `${text.slice(0, 180)}…` : text}`;
	});
	return formatListBlock(
		"comments",
		preview,
		width,
		theme,
		comments.length > 5 ? `${comments.length - 5} more comments` : undefined,
	);
}

function formatListBlock(
	name: string,
	items: string[],
	width: number,
	theme?: RenderTheme,
	moreLabel?: string,
): string {
	if (items.length === 0) return "";
	const lines = [`  ${name}`];
	for (let i = 0; i < items.length; i++) {
		const isLast = !moreLabel && i === items.length - 1;
		const connector = isLast ? "\u2514\u2500 " : "\u251C\u2500 ";
		const valueLines = splitValueByWidth(items[i] ?? "", Math.max(20, width - 2 - 3));
		lines.push(`  ${muted(connector, theme)}${valueLines[0] ?? ""}`);
		for (const line of valueLines.slice(1))
			lines.push(`  ${muted(isLast ? "   " : "\u2502  ", theme)}${line}`);
	}
	if (moreLabel) lines.push(`  ${muted("\u2514\u2500 … ", theme)}${moreLabel}`);
	return lines.join("\n");
}

function formatTimestamp(seconds: number): string {
	const totalSeconds = Math.max(0, Math.floor(seconds));
	return `${Math.floor(totalSeconds / 60)}:${(totalSeconds % 60).toString().padStart(2, "0")}`;
}

function extractorPreview(data: VerticalData | undefined): string {
	if (!data) return "extracted JSON";
	const trans = data.transcript as { text?: string; segments?: unknown[] } | undefined;
	return (
		[
			typeof data.title === "string" && data.title ? data.title : undefined,
			typeof data.views === "number" && data.views > 0
				? `${(data.views / 1000000).toFixed(data.views >= 100000000 ? 0 : 1)}M views`
				: typeof data.views === "string" && data.views
					? `${data.views} views`
					: undefined,
			trans?.segments ? `${trans.segments.length} segments` : undefined,
			!trans?.text && typeof data.description === "string" && data.description
				? `${data.description.replaceAll(/\s+/gu, " ").trim().slice(0, 120)}${data.description.length > 120 ? "\u2026" : ""}`
				: undefined,
			Array.isArray(data.comments) && data.comments.length > 0
				? `${data.comments.length} comments`
				: undefined,
			Array.isArray(data.transcriptTracks) && data.transcriptTracks.length > 1
				? `${data.transcriptTracks.length} languages`
				: undefined,
		]
			.filter(Boolean)
			.join(" \u00B7 ") || "extracted JSON"
	);
}
