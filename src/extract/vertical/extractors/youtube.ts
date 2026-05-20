/** @file YouTube video metadata, transcript, and comment extractor. */
import { capability, type VerticalExtractor } from "../../vertical/capabilities.ts";

const ANDROID_CONTEXT = {
	client: {
		clientName: "ANDROID",
		clientVersion: "20.10.38",
	},
};

export interface YouTubeTranscriptSegment {
	text: string;
	start: number;
	duration: number;
}

export interface YouTubeComment {
	author?: string;
	text: string;
	publishedTime?: string;
	likeCount?: string;
	replyCount?: string;
	isPinned?: boolean;
}

export interface YouTubeResult {
	videoId: string;
	title?: string;
	description?: string;
	channel?: string;
	channelId?: string;
	views?: number;
	lengthSeconds?: number;
	isLiveContent?: boolean;
	transcript?: {
		languageCode: string;
		languageName?: string;
		isGenerated: boolean;
		segments: YouTubeTranscriptSegment[];
		text: string;
	};
	transcriptTracks?: Array<{
		languageCode: string;
		languageName?: string;
		isGenerated: boolean;
	}>;
	comments?: YouTubeComment[];
	commentCount?: string;
	source: {
		provider: "youtube";
		videoUrl: string;
		transcriptStatus: "fetched" | "unavailable" | "skipped";
		commentsStatus: "fetched" | "unavailable" | "skipped";
	};
}

interface YouTubeMatch extends Record<string, string> {
	videoId: string;
	language: string;
}

interface InnertubePlayerResponse {
	videoDetails?: {
		videoId?: string;
		title?: string;
		shortDescription?: string;
		author?: string;
		channelId?: string;
		viewCount?: string;
		lengthSeconds?: string;
		isLiveContent?: boolean;
	};
	captions?: {
		playerCaptionsTracklistRenderer?: CaptionTrackList;
	};
	playabilityStatus?: {
		status?: string;
		reason?: string;
	};
}

interface CaptionTrackList {
	captionTracks?: CaptionTrack[];
	translationLanguages?: unknown[];
}

interface CaptionTrack {
	baseUrl?: string;
	languageCode?: string;
	kind?: string;
	name?: { runs?: Array<{ text?: string }>; simpleText?: string };
	isTranslatable?: boolean;
}

function youtubeSchema() {
	return {
		type: "object",
		required: ["videoId", "source"],
		properties: {
			videoId: { type: "string" },
			title: { type: "string" },
			description: { type: "string" },
			channel: { type: "string" },
			channelId: { type: "string" },
			views: { type: "number" },
			lengthSeconds: { type: "number" },
			transcript: {
				type: "object",
				properties: {
					languageCode: { type: "string" },
					languageName: { type: "string" },
					isGenerated: { type: "boolean" },
					text: { type: "string" },
					segments: { type: "array", items: { type: "object" } },
				},
			},
			comments: { type: "array", items: { type: "object" } },
			commentCount: { type: "string" },
			source: { type: "object" },
		},
	};
}

export const youtubeExtractor: VerticalExtractor<YouTubeResult> = {
	capability: capability(
		"youtube",
		[
			"https://www.youtube.com/watch?v=:videoId",
			"https://youtube.com/watch?v=:videoId",
			"https://youtu.be/:videoId",
			"https://www.youtube.com/shorts/:videoId",
		],
		youtubeSchema(),
	),
	match: (url) => parseYouTubeUrl(url),
	extract: async (url, match, context, signal) => {
		const { videoId, language } = match as YouTubeMatch;
		if (!context.fetchPage || !context.fetchJsonPost || !context.fetchText) {
			throw youtubeError(
				"YOUTUBE_CONTEXT_UNAVAILABLE",
				"YouTube extraction requires page, POST JSON, and text fetch support.",
			);
		}

		const extractorContext = {
			fetchJsonPost: <T>(u: string, body: unknown, s?: AbortSignal) =>
				context.fetchJsonPost!<T>(u, body, s),
			fetchText: (u: string, s?: AbortSignal) => context.fetchText!(u, s),
			emitProgress: context.emitProgress
				? (o: { state: string; message?: string; url?: string }) => context.emitProgress!(o)
				: undefined,
		};

		const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
		await context.emitProgress?.({
			state: "loading",
			message: "fetching YouTube watch page",
			url: videoUrl,
		});
		const watchPage = await context.fetchPage(videoUrl, signal);
		const apiKey = extractInnertubeApiKey(watchPage.text);
		const webClientVersion = extractWebClientVersion(watchPage.text);

		await context.emitProgress?.({
			state: "loading",
			message: "discovering transcript tracks",
			url: videoUrl,
		});
		const player = await fetchPlayer(videoId, apiKey, extractorContext, signal);
		assertPlayable(player, videoId);
		const details = player.videoDetails ?? {};
		const tracks = player.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
		const transcriptTrack = chooseTranscriptTrack(tracks, language);
		const transcript = transcriptTrack
			? await fetchTranscript(transcriptTrack, extractorContext, signal)
			: undefined;

		const comments = await fetchComments(
			videoId,
			apiKey,
			webClientVersion,
			extractorContext,
			signal,
		);

		return {
			videoId,
			title: details.title,
			description: details.shortDescription,
			channel: details.author,
			channelId: details.channelId,
			views: parseNumber(details.viewCount),
			lengthSeconds: parseNumber(details.lengthSeconds),
			isLiveContent: details.isLiveContent,
			transcript,
			transcriptTracks: tracks.map((t) => trackSummary(t)).filter((t) => isDefined(t)),
			comments: comments.comments,
			commentCount: comments.commentCount,
			source: {
				provider: "youtube",
				videoUrl,
				transcriptStatus: transcript ? "fetched" : tracks.length > 0 ? "unavailable" : "skipped",
				commentsStatus: comments.comments.length > 0 ? "fetched" : "unavailable",
			},
		};
	},
};

function parseYouTubeUrl(url: URL): YouTubeMatch | undefined {
	const hostname = url.hostname.replace(/^www\./u, "");
	const language = url.searchParams.get("lang") ?? "en";
	if (hostname === "youtu.be") {
		const videoId = url.pathname.split("/").find(Boolean);
		return videoId ? { videoId, language } : undefined;
	}
	if (hostname !== "youtube.com" && hostname !== "m.youtube.com") return undefined;
	if (url.pathname === "/watch") {
		const videoId = url.searchParams.get("v") ?? undefined;
		return videoId ? { videoId, language } : undefined;
	}
	const parts = url.pathname.split("/").filter(Boolean);
	if (parts[0] === "shorts" && parts[1]) return { videoId: parts[1], language };
	return undefined;
}

interface PostJsonContext {
	fetchJsonPost<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T>;
}

interface TextFetchContext {
	fetchText(url: string, signal?: AbortSignal): Promise<string>;
	emitProgress?(options: { state: string; message?: string; url?: string }): void | Promise<void>;
}

async function fetchPlayer(
	videoId: string,
	apiKey: string,
	context: PostJsonContext,
	signal?: AbortSignal,
): Promise<InnertubePlayerResponse> {
	return await context.fetchJsonPost<InnertubePlayerResponse>(
		`https://www.youtube.com/youtubei/v1/player?key=${encodeURIComponent(apiKey)}`,
		{ context: ANDROID_CONTEXT, videoId },
		signal,
	);
}

async function fetchTranscript(
	track: CaptionTrack,
	context: TextFetchContext,
	signal?: AbortSignal,
): Promise<YouTubeResult["transcript"] | undefined> {
	if (!track.baseUrl || !track.languageCode) return;
	await context.emitProgress?.({
		state: "loading",
		message: `downloading ${track.languageCode} transcript`,
		url: track.baseUrl,
	});
	const raw = await context.fetchText(track.baseUrl.replace("&fmt=srv3", ""), signal);
	const segments = parseTranscriptXml(raw);
	if (segments.length === 0) return;
	return {
		languageCode: track.languageCode,
		languageName: captionName(track),
		isGenerated: track.kind === "asr",
		segments,
		text: segments.map((segment) => segment.text).join("\n"),
	};
}

async function fetchComments(
	videoId: string,
	apiKey: string,
	clientVersion: string,
	context: PostJsonContext & {
		emitProgress?(options: { state: string; message?: string; url?: string }): void | Promise<void>;
	},
	signal?: AbortSignal,
): Promise<{ comments: YouTubeComment[]; commentCount?: string }> {
	try {
		await context.emitProgress?.({
			state: "loading",
			message: "fetching comment preview",
			url: `https://www.youtube.com/watch?v=${videoId}`,
		});
		const next = await context.fetchJsonPost<unknown>(
			`https://www.youtube.com/youtubei/v1/next?key=${encodeURIComponent(apiKey)}`,
			{
				context: { client: { clientName: "WEB", clientVersion, hl: "en", gl: "US" } },
				videoId,
			},
			signal,
		);
		const commentCount = findCommentCount(next);
		const token = findContinuationToken(next, "comments-section");
		if (!token) return { comments: [], commentCount };
		const commentsResponse = await context.fetchJsonPost<unknown>(
			`https://www.youtube.com/youtubei/v1/next?key=${encodeURIComponent(apiKey)}`,
			{
				context: { client: { clientName: "WEB", clientVersion, hl: "en", gl: "US" } },
				continuation: token,
			},
			signal,
		);
		return {
			comments: collectComments(commentsResponse).slice(0, 20),
			commentCount,
		};
	} catch {
		return { comments: [] };
	}
}

function extractInnertubeApiKey(html: string): string {
	const match = /"INNERTUBE_API_KEY"\s*:\s*"([A-Za-z0-9_-]+)"/u.exec(html);
	if (!match?.[1])
		throw youtubeError("YOUTUBE_API_KEY_NOT_FOUND", "Could not find YouTube Innertube API key.");
	return match[1];
}

function extractWebClientVersion(html: string): string {
	return (
		/"INNERTUBE_CONTEXT_CLIENT_VERSION"\s*:\s*"([^"]+)"/u.exec(html)?.[1] ?? "2.20260519.01.00"
	);
}

function assertPlayable(player: InnertubePlayerResponse, videoId: string): void {
	const status = player.playabilityStatus?.status;
	if (!status || status === "OK") return;
	throw youtubeError(
		"YOUTUBE_VIDEO_UNPLAYABLE",
		`YouTube video ${videoId} is not playable: ${player.playabilityStatus?.reason ?? status}`,
	);
}

function chooseTranscriptTrack(tracks: CaptionTrack[], language: string): CaptionTrack | undefined {
	return (
		tracks.find((track) => track.languageCode === language && track.kind !== "asr") ??
		tracks.find((track) => track.languageCode === language) ??
		tracks.find((track) => track.kind !== "asr") ??
		tracks[0]
	);
}

function trackSummary(track: CaptionTrack) {
	if (!track.languageCode) return;
	return {
		languageCode: track.languageCode,
		languageName: captionName(track),
		isGenerated: track.kind === "asr",
	};
}

function captionName(track: CaptionTrack): string | undefined {
	return track.name?.simpleText ?? track.name?.runs?.map((run) => run.text ?? "").join("");
}

function parseTranscriptXml(raw: string): YouTubeTranscriptSegment[] {
	const segments: YouTubeTranscriptSegment[] = [];
	const pattern = /<text\b([^>]*)>([\s\S]*?)<\/text>/gu;
	for (const match of raw.matchAll(pattern)) {
		const attrs = match[1];
		const start = parseFloat(attr(attrs, "start") ?? "0");
		const duration = parseFloat(attr(attrs, "dur") ?? "0");
		const text = decodeEntities(stripTags(match[2])).trim();
		if (text) segments.push({ text, start, duration });
	}
	return segments;
}

function attr(attrs: string, name: string): string | undefined {
	return new RegExp(`${name}="([^"]*)"`, "u").exec(attrs)?.[1];
}

function stripTags(value: string): string {
	return value.replaceAll(/<[^>]*>/gu, "");
}

function decodeEntities(value: string): string {
	return value
		.replaceAll("&amp;", "&")
		.replaceAll("&quot;", '"')
		.replaceAll("&#39;", "'")
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">");
}

function parseNumber(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const parsed = Number(value.replaceAll(",", ""));
	return Number.isFinite(parsed) ? parsed : undefined;
}

function collectComments(value: unknown): YouTubeComment[] {
	const comments: YouTubeComment[] = [];
	walkObjects(value, (object) => {
		const oldComment = object["commentRenderer"];
		if (isObject(oldComment)) {
			const text = runsText(getObject(oldComment, "contentText"));
			if (text) {
				comments.push({
					author: runsText(getObject(oldComment, "authorText")),
					text,
					publishedTime: runsText(getObject(oldComment, "publishedTimeText")),
					likeCount: runsText(getObject(oldComment, "voteCount")),
				});
			}
		}
		const entityPayload = object["commentEntityPayload"];
		if (isObject(entityPayload)) {
			const properties = getObject(entityPayload, "properties");
			const author = getObject(entityPayload, "author");
			const toolbar = getObject(entityPayload, "toolbar");
			const content = isObject(properties) ? getObject(properties, "content") : undefined;
			const text =
				isObject(content) && typeof content["content"] === "string"
					? content["content"]
					: undefined;
			if (text) {
				comments.push({
					author:
						isObject(author) && typeof author["displayName"] === "string"
							? author["displayName"]
							: undefined,
					text,
					publishedTime:
						isObject(properties) && typeof properties["publishedTime"] === "string"
							? properties["publishedTime"]
							: undefined,
					likeCount:
						isObject(toolbar) && typeof toolbar["likeCountNotliked"] === "string"
							? toolbar["likeCountNotliked"]
							: undefined,
					replyCount:
						isObject(toolbar) && typeof toolbar["replyCount"] === "string"
							? toolbar["replyCount"]
							: undefined,
					isPinned: isObject(properties) && typeof properties["pinnedText"] === "string",
				});
			}
		}
		const viewModel = object["commentViewModel"];
		if (isObject(viewModel)) {
			const text =
				firstStringByKey(viewModel, "content") ?? firstStringByKey(viewModel, "commentText");
			if (text) comments.push({ text, isPinned: Boolean(viewModel["pinnedText"]) });
		}
	});
	return dedupeComments(comments);
}

function findCommentCount(value: unknown): string | undefined {
	let found: string | undefined;
	walkObjects(value, (object) => {
		if (found) return;
		const header = object["commentsHeaderRenderer"];
		if (!isObject(header)) return;
		found = runsText(getObject(header, "countText"));
	});
	return found;
}

function findContinuationToken(value: unknown, needle: string): string | undefined {
	let fallback: string | undefined;
	let found: string | undefined;
	walkObjects(value, (object) => {
		if (found) return;
		const command = object["continuationCommand"];
		if (!isObject(command)) return;
		const token = typeof command["token"] === "string" ? command["token"] : undefined;
		if (!token) return;
		fallback ??= token;
		if (token.includes(needle)) found = token;
	});
	return found ?? fallback;
}

function runsText(value: unknown): string | undefined {
	if (!isObject(value)) return;
	if (typeof value["simpleText"] === "string") return value["simpleText"];
	const runs = value["runs"];
	if (!Array.isArray(runs)) return;
	const text = runs
		.map((run) => (isObject(run) && typeof run["text"] === "string" ? run["text"] : ""))
		.join("");
	return text || undefined;
}

function firstStringByKey(value: unknown, key: string): string | undefined {
	let found: string | undefined;
	walkObjects(value, (object) => {
		if (!found && typeof object[key] === "string") found = object[key];
	});
	return found;
}

function getObject(object: Record<string, unknown>, key: string): unknown {
	return object[key];
}

function walkObjects(value: unknown, visit: (object: Record<string, unknown>) => void): void {
	if (Array.isArray(value)) {
		for (const item of value) walkObjects(item, visit);
		return;
	}
	if (!isObject(value)) return;
	visit(value);
	for (const child of Object.values(value)) walkObjects(child, visit);
}

function dedupeComments(comments: YouTubeComment[]): YouTubeComment[] {
	const seen = new Set<string>();
	return comments.filter((comment) => {
		const key = `${comment.author ?? ""}\n${comment.text}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isDefined<T>(value: T | undefined): value is T {
	return value !== undefined;
}

class YouTubeExtractorError extends Error {
	structured: { code: string; message: string; retryable: boolean };
	constructor(code: string, message: string) {
		super(message);
		this.name = "YouTubeExtractorError";
		this.structured = { code, message, retryable: false };
	}
}

function youtubeError(code: string, message: string): YouTubeExtractorError {
	return new YouTubeExtractorError(code, message);
}
