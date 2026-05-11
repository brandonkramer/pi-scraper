/** @file Reddit comment extraction helpers. */
import { stripUndefined } from "../../../text.ts";
// oxlint-disable-next-line import/no-cycle -- vertical extractors and storage modules share type contracts; cycle is resolved at call time
import { absoluteRedditUrl } from "./index.ts";
import type { RedditCommentData, RedditListing } from "./index.ts";

const COMMENT_LIMIT = 5;

export function extractTopComments(listing: RedditListing<RedditCommentData> | undefined):
	| Array<{
			id: string;
			author?: string;
			body?: string;
			score?: number;
			createdUtc?: number;
			permalink?: string;
	  }>
	| undefined {
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
	return topComments.length > 0 ? topComments : undefined;
}
