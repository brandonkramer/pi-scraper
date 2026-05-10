/**
 * @fileoverview Reddit vertical extractor — entrypoint, types, and error utilities.
 */
import {
	createStructuredError,
	hasStructuredError,
} from "../../../../http/errors.ts";
import {
	capability,
	type VerticalExtractor,
} from "../../../vertical/capabilities.ts";
import { fetchFirstAllowedRedditEndpoint } from "./post.ts";

export interface RedditPostData {
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

export interface RedditCommentData {
	id?: string;
	author?: string;
	body?: string;
	score?: number;
	created_utc?: number;
	permalink?: string;
}

export interface RedditListing<T> {
	kind?: string;
	data?: {
		children?: Array<{ kind?: string; data?: T }>;
	};
}

export interface RedditPostMatch extends Record<string, string> {
	postId: string;
	subreddit: string;
	canonicalUrl: string;
}

export interface RedditPostResult {
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

export function redditSchema() {
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

export function normalizeRedditError(error: unknown): Error {
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

export function errorCode(error: Error): string {
	return hasStructuredError(error)
		? error.structured.code
		: "REDDIT_EXTRACTION_FAILED";
}

export function errorRetryable(error: Error): boolean {
	return hasStructuredError(error)
		? Boolean(error.structured.retryable)
		: false;
}

export function absoluteRedditUrl(value?: string): string | undefined {
	if (!value) return undefined;
	return value.startsWith("/") ? `https://www.reddit.com${value}` : value;
}

export function redditError(
	code: string,
	message: string,
	retryable: boolean,
): Error {
	return createStructuredError(
		{
			code,
			phase: "extract",
			message,
			retryable,
		},
		"RedditExtractionError",
	);
}

export { hasStructuredError } from "../../../../http/errors.ts";
export {
	fetchFirstAllowedRedditEndpoint,
	shouldTryNextEndpoint,
	blockedMetadataResult,
	withAttemptContext,
} from "./post.ts";

export const redditExtractor: VerticalExtractor<RedditPostResult> = {
	capability: capability(
		"reddit",
		[
			"https://www.reddit.com/r/:subreddit/comments/:postId/:slug*",
			"https://old.reddit.com/r/:subreddit/comments/:postId/:slug*",
			"https://redd.it/:postId",
		],
		redditSchema(),
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

function cleanPostId(value: string | undefined): string | undefined {
	const cleaned = value?.match(/^[A-Za-z0-9]+/u)?.[0]?.toLowerCase();
	return cleaned || undefined;
}
