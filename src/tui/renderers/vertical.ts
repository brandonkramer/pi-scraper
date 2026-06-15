import type { PiToolShell } from "../../types.ts";
import { buildToolResultTree, splitValueByWidth, toolResultTree } from "../tool-result-tree.ts";
import type { ToolResultGroup } from "../tool-result-tree.ts";
import { buildToolResultDetails } from "../tool-result.ts";
import { activity, failure, muted, renderDynamicText, success } from "../tui.ts";
import type { RenderComponent, RenderTheme } from "../types.ts";

type VerticalData = Record<string, unknown>;
type BrowserFallback = { used: boolean; backend: string };
type VerticalComment = {
	author?: string;
	owner?: string;
	username?: string;
	text?: string;
	body?: string;
	bodyHtml?: string;
};
type VerticalAnswer = { owner?: string; body?: string; score?: number; isAccepted?: boolean };
type TranscriptSegment = { text: string; start: number; duration?: number };
type TranscriptPreview = { segments?: TranscriptSegment[]; text?: string };
type BlockedSource = { reason?: string; attemptedEndpoints?: string[] };
type SourceInfo = {
	provider?: string;
	videoUrl?: string;
	endpoint?: string;
	finalUrl?: string;
	articleEndpoint?: string;
	articleFinalUrl?: string;
	commentsEndpoint?: string;
	commentsFinalUrl?: string;
};

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

	const error = (wrapper?.error ?? details?.error) as
		| { code?: string; message?: string }
		| undefined;
	if (error) {
		const detail = [error.code ?? "FAILED", error.message].filter(Boolean).join(" \u00B7 ");
		return renderVerticalText(
			() =>
				`\u2514\u2500 ${failure("\u2715", theme)} ${name} failed${muted(` \u00B7 ${detail}`, theme)}`,
		);
	}

	const data = wrapper?.data as VerticalData | undefined;
	const blocked = (data as { source?: BlockedSource & { blocked?: boolean } } | undefined)?.source;
	if (blocked?.blocked) return renderBlockedVerticalResult(name, data, blocked, expanded, theme);
	const browser = wrapper?.browserFallback as BrowserFallback | undefined;
	const fallback = browser?.used ? ` \u00B7 browser fallback \u00B7 ${browser.backend}` : "";
	const treeLine = () =>
		`${success("\u2713", theme)} ${name} done${muted(` \u00B7 ${extractorPreview(data)}${fallback}`, theme)}`;

	if (!expanded || !data) return renderVerticalText(treeLine);

	return renderVerticalText(() => {
		const sections = buildToolResultTree(buildVerticalSections(name, data, browser));
		const transcriptBlock = formatTranscriptBlock(
			data.transcript as TranscriptPreview | undefined,
			80,
			theme,
		);
		const answersBlock = isStackOverflowLike(name, data)
			? formatAnswersBlock(data.answers as VerticalAnswer[] | undefined, 80, theme)
			: "";
		const commentsBlock = verticalCommentsBlock(name, data, theme);
		const sourceSections = buildToolResultTree(buildSourceSections(data));
		const hasVerticalBlocks = Boolean(
			transcriptBlock || answersBlock || commentsBlock || sourceSections.length > 0,
		);
		if (shouldUseGenericVerticalDetails(sections, hasVerticalBlocks))
			sections.push(
				...buildToolResultDetails(data, {
					hide: new Set<string>(),
					sectionName: "data",
				}),
			);
		const body = toolResultTree(sections, 80, theme);
		const sourceBlock = toolResultTree(sourceSections, 80, theme);
		return [treeLine(), transcriptBlock, body, answersBlock, commentsBlock, sourceBlock]
			.filter(Boolean)
			.join("\n\n");
	});
}

function isYouTubeLike(extractor: string, data: VerticalData): boolean {
	return (
		extractor === "youtube" ||
		extractor === "youtube_oembed" ||
		typeof data.videoId === "string" ||
		typeof data.channel === "string" ||
		typeof data.lengthSeconds === "number" ||
		isTranscriptPreview(data.transcript) ||
		Array.isArray(data.transcriptTracks)
	);
}

function isStackOverflowLike(extractor: string, data: VerticalData): boolean {
	return (
		extractor === "stackoverflow" || (typeof data.body === "string" && Array.isArray(data.answers))
	);
}

function isDevToLike(extractor: string, data: VerticalData): boolean {
	return (
		extractor === "devto" ||
		(typeof data.bodyMarkdown === "string" && data.author !== undefined) ||
		(typeof data.readingTimeMinutes === "number" && typeof data.publishedAt === "string")
	);
}

function isRedditPostLike(extractor: string, data: VerticalData): boolean {
	return (
		extractor === "reddit" ||
		(typeof data.subreddit === "string" &&
			(typeof data.selfText === "string" || Array.isArray(data.topComments)))
	);
}

function shouldUseGenericVerticalDetails(
	sections: ReturnType<typeof buildToolResultTree>,
	hasVerticalBlocks: boolean,
): boolean {
	if (hasVerticalBlocks) return false;
	return sections.every((section) => section.name === "extraction");
}

function buildVerticalSections(
	extractor: string,
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

	if (isStackOverflowLike(extractor, data)) {
		const questionRows: ToolResultGroup["rows"] = [];
		if (typeof data.title === "string" && data.title) questionRows.push(["title", data.title]);
		if (typeof data.body === "string" && data.body)
			questionRows.push(["body", previewPlainText(data.body, 240)]);
		if (typeof data.score === "number") questionRows.push(["score", data.score.toLocaleString()]);
		if (typeof data.viewCount === "number")
			questionRows.push(["views", data.viewCount.toLocaleString()]);
		if (typeof data.answerCount === "number")
			questionRows.push(["answers", data.answerCount.toLocaleString()]);
		if (Array.isArray(data.tags) && data.tags.length > 0)
			questionRows.push(["tags", data.tags.map(String).join(", ")]);
		sections.push({ name: "question", rows: questionRows });
		return sections;
	}

	if (isDevToLike(extractor, data)) {
		const articleRows: ToolResultGroup["rows"] = [];
		if (typeof data.title === "string" && data.title) articleRows.push(["title", data.title]);
		const author = authorName(data.author);
		if (author) articleRows.push(["author", author]);
		if (typeof data.readablePublishedDate === "string" && data.readablePublishedDate)
			articleRows.push(["published", data.readablePublishedDate]);
		else if (typeof data.publishedAt === "string" && data.publishedAt)
			articleRows.push(["published", data.publishedAt]);
		if (typeof data.readingTimeMinutes === "number")
			articleRows.push(["reading", `${data.readingTimeMinutes.toLocaleString()} min`]);
		if (typeof data.commentsCount === "number")
			articleRows.push(["comments", data.commentsCount.toLocaleString()]);
		if (Array.isArray(data.tags) && data.tags.length > 0)
			articleRows.push(["tags", data.tags.map(String).join(", ")]);
		const body = typeof data.body === "string" ? data.body : data.bodyMarkdown;
		if (typeof body === "string" && body) articleRows.push(["body", previewPlainText(body, 280)]);
		sections.push({ name: "article", rows: articleRows });
		return sections;
	}

	if (isRedditPostLike(extractor, data)) {
		const postRows: ToolResultGroup["rows"] = [];
		if (typeof data.title === "string" && data.title) postRows.push(["title", data.title]);
		if (typeof data.subreddit === "string" && data.subreddit)
			postRows.push(["subreddit", `r/${data.subreddit}`]);
		if (typeof data.author === "string" && data.author) postRows.push(["author", data.author]);
		if (typeof data.score === "number") postRows.push(["score", data.score.toLocaleString()]);
		if (typeof data.upvoteRatio === "number")
			postRows.push(["upvoted", `${Math.round(data.upvoteRatio * 100)}%`]);
		if (typeof data.commentCount === "number")
			postRows.push(["comments", data.commentCount.toLocaleString()]);
		if (typeof data.flairText === "string" && data.flairText)
			postRows.push(["flair", data.flairText]);
		if (typeof data.selfText === "string" && data.selfText)
			postRows.push(["body", previewPlainText(data.selfText, 280)]);
		sections.push({ name: "post", rows: postRows });
		return sections;
	}

	if (!isYouTubeLike(extractor, data)) return sections;

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
	else if (typeof data.permalink === "string") sourceRows.push(["url", data.permalink]);
	else if (typeof data.url === "string") sourceRows.push(["url", data.url]);
	if (includeEndpoint && source?.endpoint) sourceRows.push(["endpoint", source.endpoint]);
	if (includeEndpoint && source?.articleEndpoint)
		sourceRows.push(["articleEndpoint", source.articleEndpoint]);
	if (includeEndpoint && source?.commentsEndpoint)
		sourceRows.push(["commentsEndpoint", source.commentsEndpoint]);
	if (source?.finalUrl) sourceRows.push(["finalUrl", source.finalUrl]);
	if (source?.articleFinalUrl) sourceRows.push(["articleFinalUrl", source.articleFinalUrl]);
	if (source?.commentsFinalUrl) sourceRows.push(["commentsFinalUrl", source.commentsFinalUrl]);
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
	const timeWidth = Math.max(4, ...preview.map((segment) => formatTimestamp(segment.start).length));
	const lines = ["  transcript"];
	for (const [i, segment] of preview.entries()) {
		const isLast = segments.length <= 20 && i === preview.length - 1;
		const connector = isLast ? "\u2514\u2500 " : "\u251C\u2500 ";
		const time = formatTimestamp(segment.start).padStart(timeWidth);
		const text = segment.text.replaceAll(/\s+/gu, " ").trim();
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

function formatAnswersBlock(
	answers: VerticalAnswer[] | undefined,
	width: number,
	theme?: RenderTheme,
): string {
	if (!answers?.length) return "";
	const preview = answers.slice(0, 5).map((answer, i) => {
		const text = previewPlainText(answer.body ?? "", 180);
		const owner = typeof answer.owner === "string" ? answer.owner : `#${i + 1}`;
		const score =
			typeof answer.score === "number"
				? ` (${answer.score.toLocaleString()}${answer.isAccepted ? ", accepted" : ""})`
				: "";
		return `${owner}${score}: ${text}`;
	});
	return formatListBlock(
		"answers",
		preview,
		width,
		theme,
		answers.length > 5 ? `${answers.length - 5} more answers` : undefined,
	);
}

function formatCommentsBlock(
	comments: VerticalComment[] | undefined,
	width: number,
	theme?: RenderTheme,
	name = "comments",
): string {
	if (!comments?.length) return "";
	const preview = comments.slice(0, 5).map((comment, i) => {
		const text = previewPlainText(comment.text ?? comment.body ?? comment.bodyHtml ?? "", 180);
		const author = comment.author ?? comment.owner ?? comment.username;
		return `${author ? `${author}: ` : `${i + 1}. `}${text}`;
	});
	return formatListBlock(
		name,
		preview,
		width,
		theme,
		comments.length > 5 ? `${comments.length - 5} more comments` : undefined,
	);
}

function verticalCommentsBlock(name: string, data: VerticalData, theme?: RenderTheme): string {
	if (isStackOverflowLike(name, data) && Array.isArray(data.answers) && data.answers.length > 0)
		return "";
	if (Array.isArray(data.topComments))
		return formatCommentsBlock(data.topComments as VerticalComment[], 80, theme, "top comments");
	return formatCommentsBlock(data.comments as VerticalComment[] | undefined, 80, theme);
}

function isTranscriptPreview(value: unknown): value is TranscriptPreview {
	if (!value || typeof value !== "object") return false;
	const transcript = value as TranscriptPreview;
	return Array.isArray(transcript.segments) || typeof transcript.text === "string";
}

function authorName(value: unknown): string | undefined {
	if (!value || typeof value !== "object") return;
	const author = value as { name?: unknown; username?: unknown };
	const name = typeof author.name === "string" ? author.name : undefined;
	const username = typeof author.username === "string" ? author.username : undefined;
	if (name && username) return `${name} (@${username})`;
	return name ?? (username ? `@${username}` : undefined);
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

function previewPlainText(value: string, maxLength: number): string {
	const text = value
		.replaceAll(/<[^>]+>/gu, " ")
		.replaceAll(/\s+/gu, " ")
		.trim();
	if (text.length <= maxLength) return text;
	return `${text.slice(0, maxLength - 1)}…`;
}

function extractorPreview(data: VerticalData | undefined): string {
	if (!data) return "extracted JSON";
	const trans = data.transcript as { text?: string; segments?: unknown[] } | undefined;
	return (
		[
			typeof data.title === "string" && data.title ? data.title : undefined,
			typeof data.viewCount === "number" && data.viewCount > 0
				? `${data.viewCount.toLocaleString()} views`
				: typeof data.views === "number" && data.views > 0
					? `${(data.views / 1000000).toFixed(data.views >= 100000000 ? 0 : 1)}M views`
					: typeof data.views === "string" && data.views
						? `${data.views} views`
						: undefined,
			Array.isArray(data.answers) && data.answers.length > 0
				? `${data.answers.length} answers`
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
