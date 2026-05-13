/** @file Reddit subreddit listing extractor — front page, top, new, hot. */
import { capability, type VerticalExtractor } from "../../../vertical/capabilities.ts";
import {
	absoluteRedditUrl,
	redditError,
	normalizeRedditError,
	withAttemptContext,
	shouldTryNextEndpoint,
	type RedditListing,
	type RedditPostData,
} from "./index.ts";

export interface RedditListingResult {
	subreddit: string;
	sort?: "hot" | "top" | "new" | "rising";
	posts: Array<{
		id: string;
		title: string;
		author?: string;
		score?: number;
		numComments?: number;
		url?: string;
		permalink?: string;
		createdUtc?: number;
		isNsfw?: boolean;
		isSpoiler?: boolean;
		flairText?: string;
		linkFlair?: string;
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

export interface RedditListingMatch extends Record<string, string> {
	subreddit: string;
	sort: string;
}

function listingSchema() {
	return {
		type: "object",
		required: ["subreddit", "posts"],
		properties: {
			subreddit: { type: "string" },
			sort: { type: "string" },
			posts: {
				type: "array",
				items: {
					type: "object",
					properties: {
						id: { type: "string" },
						title: { type: "string" },
						author: { type: "string" },
						score: { type: "number" },
						numComments: { type: "number" },
						url: { type: "string" },
						permalink: { type: "string" },
						createdUtc: { type: "number" },
						isNsfw: { type: "boolean" },
						isSpoiler: { type: "boolean" },
						flairText: { type: "string" },
						linkFlair: { type: "string" },
					},
				},
			},
			source: { type: "object" },
		},
	};
}

export const redditListingExtractor: VerticalExtractor<RedditListingResult> = {
	capability: capability(
		"reddit-listing",
		[
			"https://www.reddit.com/r/:subreddit",
			"https://www.reddit.com/r/:subreddit/top",
			"https://www.reddit.com/r/:subreddit/new",
			"https://www.reddit.com/r/:subreddit/hot",
			"https://www.reddit.com/r/:subreddit/rising",
		],
		listingSchema(),
	),
	match: (url) => parseRedditListingUrl(url),
	extract: async (_url, match, context, signal) => {
		const listing = match as RedditListingMatch;
		if (!context.fetchPage) {
			throw redditError(
				"REDDIT_FETCH_UNAVAILABLE",
				"Reddit listing extraction requires page fetch support.",
				false,
			);
		}
		const endpoints = listingEndpoints(listing);
		const failures: Array<{ endpoint: string; error: ReturnType<typeof normalizeRedditError> }> =
			[];
		for (const endpoint of endpoints) {
			try {
				const page = await context.fetchPage(endpoint, signal);
				assertUsableRedditListingResponse(page.status, page.text);
				return parseListingResponse(page.text, listing, endpoint, page.finalUrl);
			} catch (error) {
				const normalized = normalizeRedditError(error);
				failures.push({ endpoint, error: normalized });
				if (!shouldTryNextEndpoint(normalized)) throw withAttemptContext(normalized, failures);
			}
		}
		if (failures.every((f) => f.error.message.includes("robots"))) {
			return blockedListingResult(listing, endpoints, failures[0]?.error.message);
		}
		throw withAttemptContext(
			failures[0]?.error ??
				redditError("REDDIT_EXTRACTION_FAILED", "Reddit listing extraction failed.", false),
			failures,
		);
	},
};

function parseRedditListingUrl(url: URL): RedditListingMatch | undefined {
	const host = url.hostname.toLowerCase();
	if (!["reddit.com", "www.reddit.com", "old.reddit.com"].includes(host)) return;
	const parts = url.pathname.split("/").filter(Boolean);
	if (parts[0]?.toLowerCase() !== "r") return;
	const subreddit = parts[1];
	if (!subreddit) return;
	// Do not match post URLs — let the post extractor handle /r/:subreddit/comments/:id
	if (parts[2]?.toLowerCase() === "comments") return;
	const sort = ["top", "new", "hot", "rising"].includes(parts[2]?.toLowerCase() ?? "")
		? parts[2].toLowerCase()
		: "hot";
	return { subreddit, sort };
}

function listingEndpoints(match: RedditListingMatch): string[] {
	const sortPath = match.sort === "hot" ? "" : `/${match.sort}`;
	const path = `/r/${encodeURIComponent(match.subreddit)}${sortPath}.json`;
	return [`https://www.reddit.com${path}`, `https://old.reddit.com${path}`];
}

function assertUsableRedditListingResponse(status: number, text: string): void {
	if (status === 401 || status === 403) {
		throw redditError(
			"REDDIT_BLOCKED",
			`Reddit listing endpoint returned HTTP ${status}; extraction is blocked.`,
			false,
		);
	}
	if (status === 429) {
		throw redditError(
			"REDDIT_RATE_LIMITED",
			"Reddit listing endpoint returned HTTP 429 rate limiting.",
			true,
		);
	}
	if (status >= 500) {
		throw redditError(
			"REDDIT_UNAVAILABLE",
			`Reddit listing endpoint returned HTTP ${status}.`,
			true,
		);
	}
	if (status >= 400) {
		throw redditError(
			"REDDIT_REQUEST_FAILED",
			`Reddit listing endpoint returned HTTP ${status}.`,
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

function parseListingResponse(
	text: string,
	match: RedditListingMatch,
	endpoint: string,
	finalUrl?: string,
): RedditListingResult {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw redditError(
			"REDDIT_RESPONSE_INVALID",
			"Reddit listing endpoint did not return valid JSON.",
			false,
		);
	}
	const listing = parsed as RedditListing<RedditPostData>;
	const children = listing.data?.children ?? [];
	if (children.length === 0) {
		throw redditError("REDDIT_LISTING_EMPTY", "Reddit listing returned no posts.", false);
	}
	return {
		subreddit: match.subreddit,
		sort: match.sort as RedditListingResult["sort"],
		posts: children.map((child) => {
			const p = child.data;
			return {
				id: p?.id ?? "",
				title: p?.title ?? "",
				author: p?.author,
				score: p?.score,
				numComments: p?.num_comments,
				url: p?.url_overridden_by_dest ?? p?.url,
				permalink: absoluteRedditUrl(p?.permalink),
				createdUtc: p?.created_utc,
				isNsfw: p?.over_18,
				isSpoiler: p?.spoiler,
				flairText: p?.link_flair_text,
				linkFlair: p?.link_flair_text,
			};
		}),
		source: { provider: "reddit", endpoint, finalUrl },
	};
}

function blockedListingResult(
	match: RedditListingMatch,
	endpoints: string[],
	reason = "Reddit disallows this listing endpoint under robots; pi-scraper will not bypass it.",
): RedditListingResult {
	return {
		subreddit: match.subreddit,
		sort: match.sort as RedditListingResult["sort"],
		posts: [],
		source: {
			provider: "reddit",
			endpoint: endpoints[0] ?? `https://www.reddit.com/r/${match.subreddit}`,
			blocked: true,
			reason,
			attemptedEndpoints: endpoints,
		},
	};
}
