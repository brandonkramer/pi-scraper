/** @file Tests for the Reddit subreddit listing extractor. */
import { describe, expect, it } from "vitest";

import { redditListingExtractor } from "../listing.ts";

const signal = new AbortController().signal;

const dummyCtx = { fetchJson: async <T>(): Promise<T> => ({}) as T };

function fakePage(text: string, status = 200, finalUrl?: string) {
	return {
		text,
		status,
		finalUrl: finalUrl ?? "https://www.reddit.com/r/test.json",
		contentType: "application/json",
	};
}

describe("redditListingExtractor.match", () => {
	it("matches /r/:subreddit", () => {
		const result = redditListingExtractor.match(
			new URL("https://www.reddit.com/r/machinelearning/"),
		);
		expect(result).toEqual({ subreddit: "machinelearning", sort: "hot" });
	});

	it("matches /r/:subreddit/top", () => {
		const result = redditListingExtractor.match(
			new URL("https://www.reddit.com/r/machinelearning/top"),
		);
		expect(result).toEqual({ subreddit: "machinelearning", sort: "top" });
	});

	it("matches /r/:subreddit/new", () => {
		const result = redditListingExtractor.match(
			new URL("https://www.reddit.com/r/machinelearning/new"),
		);
		expect(result).toEqual({ subreddit: "machinelearning", sort: "new" });
	});

	it("matches /r/:subreddit/rising", () => {
		const result = redditListingExtractor.match(
			new URL("https://www.reddit.com/r/machinelearning/rising"),
		);
		expect(result).toEqual({ subreddit: "machinelearning", sort: "rising" });
	});

	it("does NOT match post URLs", () => {
		const result = redditListingExtractor.match(
			new URL("https://www.reddit.com/r/machinelearning/comments/abc123/some_post/"),
		);
		expect(result).toBeUndefined();
	});

	it("does NOT match old.reddit.com post URLs", () => {
		const result = redditListingExtractor.match(
			new URL("https://old.reddit.com/r/machinelearning/comments/abc123/some_post/"),
		);
		expect(result).toBeUndefined();
	});

	it("does NOT match non-reddit hosts", () => {
		expect(
			redditListingExtractor.match(new URL("https://example.com/r/machinelearning/")),
		).toBeUndefined();
	});
});

describe("redditListingExtractor.extract", () => {
	it("parses a listing JSON response", async () => {
		const json = JSON.stringify({
			data: {
				children: [
					{
						data: {
							id: "p1",
							title: "First post",
							author: "alice",
							score: 42,
							num_comments: 7,
							url: "https://example.com",
							permalink: "/r/test/comments/p1/first/",
							created_utc: 1609459200,
							over_18: false,
							spoiler: false,
							link_flair_text: "Discussion",
						},
					},
					{
						data: {
							id: "p2",
							title: "Second post",
							author: "bob",
							score: 15,
							num_comments: 3,
							url_overridden_by_dest: "https://override.com",
							permalink: "/r/test/comments/p2/second/",
							created_utc: 1609545600,
							over_18: true,
							spoiler: true,
							link_flair_text: null,
						},
					},
				],
			},
		});
		const result = await redditListingExtractor.extract(
			new URL("https://www.reddit.com/r/test/"),
			{ subreddit: "test", sort: "hot" },
			{
				...dummyCtx,
				fetchPage: async () => fakePage(json),
			},
			signal,
		);
		expect(result.subreddit).toBe("test");
		expect(result.sort).toBe("hot");
		expect(result.posts).toHaveLength(2);
		expect(result.posts[0]).toMatchObject({
			id: "p1",
			title: "First post",
			author: "alice",
			score: 42,
			numComments: 7,
			url: "https://example.com",
			permalink: "https://www.reddit.com/r/test/comments/p1/first/",
			createdUtc: 1609459200,
			isNsfw: false,
			isSpoiler: false,
			flairText: "Discussion",
		});
		expect(result.posts[1]).toMatchObject({
			id: "p2",
			title: "Second post",
			author: "bob",
			score: 15,
			url: "https://override.com",
			isNsfw: true,
			isSpoiler: true,
		});
		expect(result.source.provider).toBe("reddit");
	});

	it("throws on empty listing", async () => {
		const json = JSON.stringify({ data: { children: [] } });
		await expect(
			redditListingExtractor.extract(
				new URL("https://www.reddit.com/r/empty/"),
				{ subreddit: "empty", sort: "hot" },
				{ ...dummyCtx, fetchPage: async () => fakePage(json) },
				signal,
			),
		).rejects.toThrow(/empty/u);
	});

	it("throws on invalid JSON", async () => {
		await expect(
			redditListingExtractor.extract(
				new URL("https://www.reddit.com/r/bad/"),
				{ subreddit: "bad", sort: "hot" },
				{ ...dummyCtx, fetchPage: async () => fakePage("not json") },
				signal,
			),
		).rejects.toThrow(/valid JSON/u);
	});

	it("throws on 429 rate limit", async () => {
		await expect(
			redditListingExtractor.extract(
				new URL("https://www.reddit.com/r/limited/"),
				{ subreddit: "limited", sort: "hot" },
				{ ...dummyCtx, fetchPage: async () => fakePage("", 429) },
				signal,
			),
		).rejects.toThrow(/429/u);
	});

	it("returns blocked result when all endpoints are robots-denied", async () => {
		const result = await redditListingExtractor.extract(
			new URL("https://www.reddit.com/r/blocked/"),
			{ subreddit: "blocked", sort: "hot" },
			{
				...dummyCtx,
				fetchPage: async () => {
					throw Object.assign(new Error("robots"), {
						structured: { code: "REDDIT_ROBOTS_DENIED", message: "robots", retryable: false },
					});
				},
			},
			signal,
		);
		expect(result.posts).toHaveLength(0);
		expect(result.source.blocked).toBe(true);
	});
});
