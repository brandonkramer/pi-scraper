/**
 * @fileoverview extract verticals reddit module.
 */
import { capability, type VerticalExtractor } from "../capabilities.js";
const COMMENT_LIMIT = 5;
interface RedditPostData {
	id?: string;
	subreddit?: string;
	title?: string;
	author?: string;
	created_utc?: number;
	permalink?: string;
	url?: string;
	url_overridden_by_dest?: string;
	selftext?: string;
	score?: number;
	upvote_ratio?: number;
	num_comments?: number;
	link_flair_text?: string;
	over_18?: boolean;
	spoiler?: boolean;
	locked?: boolean;
	stickied?: boolean;
	archived?: boolean;
}
interface RedditCommentData {
	id?: string;
	author?: string;
	body?: string;
	score?: number;
	created_utc?: number;
	permalink?: string;
}
interface RedditListing<T> {
	kind?: string;
	data?: {
		children?: Array<{ kind?: string; data?: T }>;
	};
}

interface RedditPostMatch extends Record<string, string> {
	postId: string;
	subreddit: string;
	canonicalUrl: string;
}

interface RedditPostResult {
	id: string;
	subreddit?: string;
	title?: string;
	author?: string;
	createdUtc?: number;
	permalink?: string;
	url?: string;
	selfText?: string;
	score?: number;
	upvoteRatio?: number;
	commentCount?: number;
	flairText?: string;
	isNsfw?: boolean;
	isSpoiler?: boolean;
	isLocked?: boolean;
	isStickied?: boolean;
	isArchived?: boolean;
	topComments?: Array<{
		id: string;
		author?: string;
		body?: string;
		score?: number;
		createdUtc?: number;
		permalink?: string;
	}>;
	source: {
		provider: "reddit";
		endpoint: string;
		finalUrl?: string;
		blocked?: boolean;
		reason?: string;
		attemptedEndpoints?: string[];
	};
}

export const redditExtractor: VerticalExtractor<RedditPostResult> = {
	capability: capability(
		"reddit",
		[
			"https://www.reddit.com/r/:subreddit/comments/:postId/:slug*",
			"https://old.reddit.com/r/:subreddit/comments/:postId/:slug*",
			"https://redd.it/:postId",
		],
		redditSchema(),
		{ requiresBrowser: false, requiresLLM: false, requiresCloud: false },
	),
	match: (url) => parseRedditPostUrl(url),
	extract: async (_url, match, context, signal) => {
		const reddit = match as RedditPostMatch;
		if (!context.fetchPage) {
			throw redditError(
				"REDDIT_FETCH_UNAVAILABLE",
				"Reddit extraction requires page fetch support so robots and HTTP status can be enforced.",
				false,
			);
		}
		return fetchFirstAllowedRedditEndpoint(reddit, context.fetchPage, signal);
	},
};

function parseRedditPostUrl(url: URL): RedditPostMatch | undefined {
	const host = url.hostname.toLowerCase();
	const parts = url.pathname.split("/").filter(Boolean);
	if (host === "redd.it") {
		const postId = cleanPostId(parts[0]);
		if (!postId) return undefined;
		return {
			postId,
			subreddit: "",
			canonicalUrl: `https://redd.it/${postId}`,
		};
	}
	if (!["reddit.com", "www.reddit.com", "old.reddit.com"].includes(host)) {
		return undefined;
	}
	if (
		parts[0]?.toLowerCase() !== "r" ||
		parts[2]?.toLowerCase() !== "comments"
	) {
		return undefined;
	}
	const subreddit = parts[1];
	const postId = cleanPostId(parts[3]);
	if (!subreddit || !postId) return undefined;
	return {
		postId,
		subreddit,
		canonicalUrl: `https://www.reddit.com/r/${subreddit}/comments/${postId}/`,
	};
}

async function fetchFirstAllowedRedditEndpoint(
	match: RedditPostMatch,
	fetchPage: NonNullable<
		Parameters<VerticalExtractor["extract"]>[2]["fetchPage"]
	>,
	signal?: AbortSignal,
): Promise<RedditPostResult> {
	const endpoints = redditEndpoints(match);
	const failures: Array<{
		endpoint: string;
		error: ReturnType<typeof normalizeRedditError>;
	}> = [];
	for (const endpoint of endpoints) {
		try {
			const page = await fetchPage(endpoint, signal);
			assertUsableRedditResponse(page.status, page.text);
			return parseRedditResponse(page.text, match, endpoint, page.finalUrl);
		} catch (error) {
			const normalized = normalizeRedditError(error);
			failures.push({ endpoint, error: normalized });
			if (!shouldTryNextEndpoint(normalized))
				throw withAttemptContext(normalized, failures);
		}
	}
	if (
		failures.every(
			(failure) => errorCode(failure.error) === "REDDIT_ROBOTS_DENIED",
		)
	) {
		return blockedMetadataResult(match, endpoints, failures[0]?.error.message);
	}
	throw withAttemptContext(
		failures[0]?.error ??
			redditError(
				"REDDIT_EXTRACTION_FAILED",
				"Reddit extraction failed.",
				false,
			),
		failures,
	);
}

function redditEndpoints(match: RedditPostMatch): string[] {
	const endpoints: string[] = [];
	if (match.subreddit) {
		const path = `/r/${encodeURIComponent(match.subreddit)}/comments/${match.postId}.json`;
		endpoints.push(redditEndpoint("https://www.reddit.com", path));
		endpoints.push(redditEndpoint("https://old.reddit.com", path));
	}
	endpoints.push(
		redditEndpoint("https://www.reddit.com", `/comments/${match.postId}.json`),
	);
	endpoints.push(
		redditEndpoint("https://www.reddit.com", `/by_id/t3_${match.postId}.json`),
	);
	return unique(endpoints);
}

function redditEndpoint(origin: string, path: string): string {
	const url = new URL(path, origin);
	url.searchParams.set("limit", String(COMMENT_LIMIT));
	url.searchParams.set("raw_json", "1");
	return url.toString();
}

function shouldTryNextEndpoint(error: Error): boolean {
	return [
		"REDDIT_ROBOTS_DENIED",
		"REDDIT_RESPONSE_INVALID",
		"REDDIT_POST_NOT_FOUND",
	].includes(errorCode(error));
}

function blockedMetadataResult(
	match: RedditPostMatch,
	endpoints: string[],
	reason = "Reddit disallows this structured endpoint under robots; pi-scraper will not bypass it.",
): RedditPostResult {
	return stripUndefined({
		id: match.postId,
		subreddit: match.subreddit || undefined,
		permalink: match.canonicalUrl,
		source: {
			provider: "reddit",
			endpoint: endpoints[0] ?? match.canonicalUrl,
			blocked: true,
			reason,
			attemptedEndpoints: endpoints,
		},
	});
}

function withAttemptContext(
	error: Error,
	failures: Array<{ endpoint: string; error: Error }>,
): Error {
	const attempted = failures.map((failure) => failure.endpoint).join(", ");
	return redditError(
		errorCode(error),
		`${error.message} attempted: ${attempted}`,
		errorRetryable(error),
	);
}

function assertUsableRedditResponse(status: number, text: string): void {
	if (status === 401 || status === 403) {
		throw redditError(
			"REDDIT_BLOCKED",
			`Reddit structured endpoint returned HTTP ${status}; extraction is blocked or requires authorization.`,
			false,
		);
	}
	if (status === 429) {
		throw redditError(
			"REDDIT_RATE_LIMITED",
			"Reddit structured endpoint returned HTTP 429 rate limiting.",
			true,
		);
	}
	if (status >= 500) {
		throw redditError(
			"REDDIT_UNAVAILABLE",
			`Reddit structured endpoint returned HTTP ${status}.`,
			true,
		);
	}
	if (status >= 400) {
		throw redditError(
			"REDDIT_REQUEST_FAILED",
			`Reddit structured endpoint returned HTTP ${status}.`,
			false,
		);
	}
	if (
		!looksLikeJson(text) &&
		/enable javascript|blocked|captcha|too many requests/iu.test(text)
	) {
		throw redditError(
			"REDDIT_BLOCKED",
			"Reddit returned an anti-bot or non-API response instead of structured JSON.",
			false,
		);
	}
}

function parseRedditResponse(
	text: string,
	match: RedditPostMatch,
	endpoint: string,
	finalUrl?: string,
): RedditPostResult {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw redditError(
			"REDDIT_RESPONSE_INVALID",
			"Reddit structured endpoint did not return valid JSON.",
			false,
		);
	}
	const [postListing, commentListing] = redditListings(parsed);
	const post = postListing.data?.children?.[0]?.data;
	if (!post?.id) {
		throw redditError(
			"REDDIT_POST_NOT_FOUND",
			"Reddit JSON response did not include the requested post.",
			false,
		);
	}
	return stripUndefined({
		id: post.id,
		subreddit: (post.subreddit ?? match.subreddit) || undefined,
		title: post.title,
		author: post.author,
		createdUtc: post.created_utc,
		permalink: absoluteRedditUrl(post.permalink),
		url: post.url_overridden_by_dest ?? post.url,
		selfText: post.selftext,
		score: post.score,
		upvoteRatio: post.upvote_ratio,
		commentCount: post.num_comments,
		flairText: post.link_flair_text,
		isNsfw: post.over_18,
		isSpoiler: post.spoiler,
		isLocked: post.locked,
		isStickied: post.stickied,
		isArchived: post.archived,
		topComments: extractTopComments(commentListing),
		source: { provider: "reddit", endpoint, finalUrl },
	});
}

function redditListings(
	parsed: unknown,
): [
	RedditListing<RedditPostData>,
	RedditListing<RedditCommentData> | undefined,
] {
	if (Array.isArray(parsed) && parsed.length >= 1) {
		return [
			parsed[0] as RedditListing<RedditPostData>,
			parsed[1] as RedditListing<RedditCommentData> | undefined,
		];
	}
	if (isRedditListing(parsed))
		return [parsed as RedditListing<RedditPostData>, undefined];
	throw redditError(
		"REDDIT_RESPONSE_INVALID",
		"Reddit JSON response did not include a post listing.",
		false,
	);
}

function isRedditListing(value: unknown): value is RedditListing<unknown> {
	return Boolean(
		value &&
			typeof value === "object" &&
			Array.isArray(
				(value as { data?: { children?: unknown } }).data?.children,
			),
	);
}

function extractTopComments(
	listing: RedditListing<RedditCommentData> | undefined,
): RedditPostResult["topComments"] {
	const comments = listing?.data?.children ?? [];
	const topComments = comments
		.filter((child) => child.kind === "t1" && child.data?.id)
		.slice(0, COMMENT_LIMIT)
		.map((child) => {
			const data = child.data as RedditCommentData;
			return stripUndefined({
				id: data.id ?? "",
				author: data.author,
				body: data.body,
				score: data.score,
				createdUtc: data.created_utc,
				permalink: absoluteRedditUrl(data.permalink),
			});
		});
	return topComments.length ? topComments : undefined;
}

function looksLikeJson(text: string): boolean {
	return /^[\s\r\n]*[[{]/u.test(text);
}

function cleanPostId(value: string | undefined): string | undefined {
	const cleaned = value?.match(/^[A-Za-z0-9]+/u)?.[0]?.toLowerCase();
	return cleaned || undefined;
}

function absoluteRedditUrl(value?: string): string | undefined {
	if (!value) return undefined;
	return value.startsWith("/") ? `https://www.reddit.com${value}` : value;
}

function unique(values: string[]): string[] {
	return [...new Set(values)];
}

function redditSchema() {
	return {
		type: "object",
		required: ["id", "source"],
		properties: {
			id: { type: "string" },
			subreddit: { type: "string" },
			title: { type: "string" },
			author: { type: "string" },
			createdUtc: { type: "number" },
			permalink: { type: "string" },
			url: { type: "string" },
			selfText: { type: "string" },
			score: { type: "number" },
			upvoteRatio: { type: "number" },
			commentCount: { type: "number" },
			flairText: { type: "string" },
			isNsfw: { type: "boolean" },
			isSpoiler: { type: "boolean" },
			isLocked: { type: "boolean" },
			isStickied: { type: "boolean" },
			isArchived: { type: "boolean" },
			topComments: { type: "array", items: { type: "object" } },
			source: { type: "object" },
		},
	};
}

function normalizeRedditError(error: unknown): Error {
	if (hasStructuredError(error)) {
		const structured = error.structured;
		if (structured.code === "ROBOTS_DENIED") {
			return redditError("REDDIT_ROBOTS_DENIED", structured.message, false);
		}
		return redditError(
			String(structured.code),
			String(structured.message),
			Boolean(structured.retryable),
		);
	}
	if (error instanceof Error && hasStructuredError(error.cause)) {
		return normalizeRedditError(error.cause);
	}
	return error instanceof Error
		? error
		: redditError(
				"REDDIT_EXTRACTION_FAILED",
				"Reddit extraction failed.",
				false,
			);
}

function errorCode(error: Error): string {
	return hasStructuredError(error)
		? error.structured.code
		: "REDDIT_EXTRACTION_FAILED";
}

function errorRetryable(error: Error): boolean {
	return hasStructuredError(error)
		? Boolean(error.structured.retryable)
		: false;
}

function redditError(
	code: string,
	message: string,
	retryable: boolean,
): Error & {
	structured: { code: string; message: string; retryable: boolean };
} {
	const error = new Error(message) as Error & {
		structured: { code: string; message: string; retryable: boolean };
	};
	error.name = "RedditExtractionError";
	error.structured = { code, message, retryable };
	return error;
}

function hasStructuredError(error: unknown): error is {
	structured: { code: string; message: string; retryable?: boolean };
} {
	if (!error || typeof error !== "object") return false;
	const structured = (error as { structured?: unknown }).structured;
	return Boolean(
		structured &&
			typeof structured === "object" &&
			typeof (structured as { code?: unknown }).code === "string" &&
			typeof (structured as { message?: unknown }).message === "string",
	);
}

function stripUndefined<T extends object>(value: T): T {
	return Object.fromEntries(
		Object.entries(value).filter(
			([, item]) => item !== undefined && item !== "",
		),
	) as T;
}
