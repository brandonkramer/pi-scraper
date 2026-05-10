/**
 * @fileoverview Reddit post fetch and parse logic.
 */
import { stripUndefined } from "../../../shared/text.ts";
import {
	type RedditCommentData,
	type RedditListing,
	type RedditPostData,
	type RedditPostMatch,
	type RedditPostResult,
	redditError,
	errorCode,
	normalizeRedditError,
} from "./index.ts";
import { extractTopComments } from "./comments.ts";

const COMMENT_LIMIT = 5;

export async function fetchFirstAllowedRedditEndpoint(
	match: RedditPostMatch,
	fetchPage: NonNullable<
		import("../../../vertical/capabilities.ts").VerticalExtractorContext["fetchPage"]
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
	return [...new Set(endpoints)];
}

function redditEndpoint(origin: string, path: string): string {
	const url = new URL(path, origin);
	url.searchParams.set("limit", String(COMMENT_LIMIT));
	url.searchParams.set("raw_json", "1");
	return url.toString();
}

export function shouldTryNextEndpoint(error: Error): boolean {
	return [
		"REDDIT_ROBOTS_DENIED",
		"REDDIT_RESPONSE_INVALID",
		"REDDIT_POST_NOT_FOUND",
	].includes(errorCode(error));
}

export function blockedMetadataResult(
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

export function withAttemptContext(
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

function errorRetryable(error: Error): boolean {
	return hasStructuredError(error)
		? Boolean(error.structured.retryable)
		: false;
}

function hasStructuredError(
	error: unknown,
): error is {
	structured: { code: string; message: string; retryable?: boolean };
} {
	return (
		typeof error === "object" &&
		error !== null &&
		"structured" in error &&
		typeof (error as { structured?: unknown }).structured === "object" &&
		(error as { structured?: { code?: string } }).structured?.code !== undefined
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
		!/^[[\s\r\n]*[[{]/u.test(text) &&
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

function absoluteRedditUrl(value?: string): string | undefined {
	if (!value) return undefined;
	return value.startsWith("/") ? `https://www.reddit.com${value}` : value;
}
