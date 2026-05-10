/**
 * @fileoverview Reddit comment extraction helpers.
 */
import { stripUndefined } from "../../../shared/text.ts";
import type { RedditCommentData, RedditListing } from "./index.ts";

const COMMENT_LIMIT = 5;

export function extractTopComments(
	listing: RedditListing<RedditCommentData> | undefined,
): Array<{
	id: string;
	author?: string;
	body?: string;
	score?: number;
	createdUtc?: number;
	permalink?: string;
}> | undefined {
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

function absoluteRedditUrl(value?: string): string | undefined {
	if (!value) return undefined;
	return value.startsWith("/") ? `https://www.reddit.com${value}` : value;
}
