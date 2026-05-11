/** @file Extract **tests** reddit.test module. */
import { describe, expect, it } from "vitest";

import type { VerticalExtractorContext } from "../../vertical/capabilities.ts";
import { runVerticalExtractor } from "../../vertical/registry.ts";

const redditJson = JSON.stringify([
	{
		kind: "Listing",
		data: {
			children: [
				{
					kind: "t3",
					data: {
						id: "14f4h6s",
						subreddit: "announcements",
						title: "Reddit API changes",
						author: "reddit",
						created_utc: 1687377600,
						permalink:
							"/r/announcements/comments/14f4h6s/reddit_api_changes_subreddit_blackouts_and_how/",
						url: "https://www.reddit.com/r/announcements/comments/14f4h6s/reddit_api_changes_subreddit_blackouts_and_how/",
						selftext: "API update details.",
						score: 1200,
						upvote_ratio: 0.82,
						num_comments: 99,
						link_flair_text: "Admin Post",
						over_18: false,
						spoiler: false,
						locked: true,
						stickied: true,
						archived: false,
					},
				},
			],
		},
	},
	{
		kind: "Listing",
		data: {
			children: [
				{
					kind: "t1",
					data: {
						id: "c1",
						author: "octo",
						body: "Thanks for the details.",
						score: 7,
						created_utc: 1687377900,
						permalink: "/r/announcements/comments/14f4h6s/x/c1/",
					},
				},
				{ kind: "more", data: { id: "more" } },
			],
		},
	},
]);

function contextFor(status: number, text: string): VerticalExtractorContext {
	return {
		fetchJson: async () => {
			throw new Error("Reddit extractor should use fetchPage, not fetchJson");
		},
		fetchPage: async (url) => ({
			text,
			status,
			finalUrl: url,
			contentType: "application/json",
		}),
	};
}

function fallbackToAllowedRedditHostContext(attempted: string[]): VerticalExtractorContext {
	return {
		fetchJson: async () => {
			throw new Error("Reddit extractor should use fetchPage");
		},
		fetchPage: async (url) => {
			attempted.push(url);
			if (url.startsWith("https://www.reddit.com/r/")) {
				throw robotsDenied(url);
			}
			return {
				text: redditJson,
				status: 200,
				finalUrl: url,
				contentType: "application/json",
			};
		},
	};
}

function robotsDenied(url: string): Error & {
	structured: { code: string; message: string; retryable: boolean };
} {
	const error = new Error(`robots.txt disallows fetching ${url}`) as Error & {
		structured: { code: string; message: string; retryable: boolean };
	};
	error.structured = {
		code: "ROBOTS_DENIED",
		message: error.message,
		retryable: false,
	};
	return error;
}

describe("reddit vertical extractor", () => {
	it("extracts public Reddit post metadata and a bounded comment sample", async () => {
		const result = await runVerticalExtractor(
			"reddit",
			"https://www.reddit.com/r/announcements/comments/14f4h6s/reddit_api_changes_subreddit_blackouts_and_how/",
			{ context: contextFor(200, redditJson) },
		);

		expect(result.error).toBeUndefined();
		expect(result.data).toMatchObject({
			id: "14f4h6s",
			subreddit: "announcements",
			title: "Reddit API changes",
			author: "reddit",
			createdUtc: 1687377600,
			selfText: "API update details.",
			score: 1200,
			upvoteRatio: 0.82,
			commentCount: 99,
			flairText: "Admin Post",
			isLocked: true,
			isStickied: true,
			topComments: [
				{
					id: "c1",
					author: "octo",
					body: "Thanks for the details.",
					permalink: "https://www.reddit.com/r/announcements/comments/14f4h6s/x/c1/",
				},
			],
			source: {
				provider: "reddit",
				endpoint: "https://www.reddit.com/r/announcements/comments/14f4h6s.json?limit=5&raw_json=1",
			},
		});
	});

	it("accepts old.reddit.com and redd.it post URL shapes", async () => {
		await expect(
			runVerticalExtractor(
				"reddit",
				"https://old.reddit.com/r/announcements/comments/14f4h6s/slug/",
				{ context: contextFor(200, redditJson) },
			),
		).resolves.toMatchObject({ data: { id: "14f4h6s" } });
		await expect(
			runVerticalExtractor("reddit", "https://redd.it/14f4h6s", {
				context: contextFor(200, redditJson),
			}),
		).resolves.toMatchObject({
			data: {
				id: "14f4h6s",
				source: {
					endpoint: "https://www.reddit.com/comments/14f4h6s.json?limit=5&raw_json=1",
				},
			},
		});
	});

	it("tries allowed structured alternatives before failing", async () => {
		const attempted: string[] = [];
		const result = await runVerticalExtractor(
			"reddit",
			"https://www.reddit.com/r/announcements/comments/14f4h6s/slug/",
			{ context: fallbackToAllowedRedditHostContext(attempted) },
		);

		expect(attempted).toEqual([
			"https://www.reddit.com/r/announcements/comments/14f4h6s.json?limit=5&raw_json=1",
			"https://old.reddit.com/r/announcements/comments/14f4h6s.json?limit=5&raw_json=1",
		]);
		expect(result.data).toMatchObject({
			id: "14f4h6s",
			source: {
				endpoint: "https://old.reddit.com/r/announcements/comments/14f4h6s.json?limit=5&raw_json=1",
			},
		});
	});

	it("falls back to URL metadata when all structured endpoints are robots-denied", async () => {
		const result = await runVerticalExtractor(
			"reddit",
			"https://www.reddit.com/r/announcements/comments/14f4h6s/slug/",
			{
				context: {
					fetchJson: async () => {
						throw new Error("Reddit extractor should use fetchPage");
					},
					fetchPage: async (url) => {
						throw robotsDenied(url);
					},
				},
			},
		);

		expect(result.error).toBeUndefined();
		expect(result.data).toMatchObject({
			id: "14f4h6s",
			subreddit: "announcements",
			permalink: "https://www.reddit.com/r/announcements/comments/14f4h6s/",
			source: {
				provider: "reddit",
				blocked: true,
			},
		});
		expect(
			(result.data as { source?: { attemptedEndpoints?: string[] } }).source?.attemptedEndpoints,
		).toHaveLength(4);
	});

	it("returns structured errors for blocked and rate-limited Reddit responses", async () => {
		await expect(
			runVerticalExtractor("reddit", "https://redd.it/14f4h6s", {
				context: contextFor(403, "blocked"),
			}),
		).resolves.toMatchObject({
			error: { code: "REDDIT_BLOCKED", retryable: false },
		});
		await expect(
			runVerticalExtractor("reddit", "https://redd.it/14f4h6s", {
				context: contextFor(429, "too many requests"),
			}),
		).resolves.toMatchObject({
			error: { code: "REDDIT_RATE_LIMITED", retryable: true },
		});
	});
});
