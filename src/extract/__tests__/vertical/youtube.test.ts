/** @file YouTube vertical extractor tests. */
import { describe, expect, it } from "vitest";

import type { VerticalExtractorContext } from "../../vertical/capabilities.ts";
import { runVerticalExtractor } from "../../vertical/registry.ts";

function youtubeContext(): VerticalExtractorContext {
	return {
		fetchJson: async <T>() => ({}) as T,
		fetchPage: async () => ({
			text: `<!doctype html><script>var ytcfg={"INNERTUBE_API_KEY":"test-key","INNERTUBE_CONTEXT_CLIENT_VERSION":"2.20260519.01.00"};</script>`,
			finalUrl: "https://www.youtube.com/watch?v=abc123",
			status: 200,
			contentType: "text/html",
		}),
		fetchJsonPost: async <T>(url: string, body: unknown) => {
			if (url.includes("/player")) {
				return {
					playabilityStatus: { status: "OK" },
					videoDetails: {
						videoId: "abc123",
						title: "Test Video",
						shortDescription: "Video description",
						author: "Test Channel",
						channelId: "UC123",
						viewCount: "12345",
						lengthSeconds: "99",
					},
					captions: {
						playerCaptionsTracklistRenderer: {
							captionTracks: [
								{
									baseUrl: "https://www.youtube.com/api/timedtext?lang=en",
									languageCode: "en",
									name: { runs: [{ text: "English" }] },
								},
							],
						},
					},
				} as T;
			}
			if (url.includes("/next")) {
				const payload = body as { continuation?: string };
				if (payload.continuation) {
					return {
						onResponseReceivedEndpoints: [
							{
								appendContinuationItemsAction: {
									continuationItems: [
										{
											commentThreadRenderer: {
												comment: {
													commentRenderer: {
														authorText: { simpleText: "Ada" },
														contentText: { runs: [{ text: "Great explanation" }] },
														publishedTimeText: { runs: [{ text: "1 year ago" }] },
														voteCount: { simpleText: "42" },
													},
												},
											},
										},
									],
								},
							},
						],
					} as T;
				}
				return {
					contents: {
						twoColumnWatchNextResults: {
							results: {
								results: {
									contents: [
										{
											itemSectionRenderer: {
												contents: [
													{
														commentsHeaderRenderer: {
															countText: { runs: [{ text: "12 Comments" }] },
														},
													},
													{
														continuationItemRenderer: {
															continuationEndpoint: {
																continuationCommand: {
																	token: "token-comments-section",
																},
															},
														},
													},
												],
											},
										},
									],
								},
							},
						},
					},
				} as T;
			}
			throw new Error(`Unexpected POST: ${url}`);
		},
		fetchText: async (url: string) => {
			expect(url).toBe("https://www.youtube.com/api/timedtext?lang=en");
			return `<transcript><text start="1.2" dur="2.3">Hello &amp; welcome</text><text start="4" dur="1">Second line</text></transcript>`;
		},
	};
}

describe("youtube vertical extractor", () => {
	it("extracts metadata, transcript, and comment preview", async () => {
		const result = await runVerticalExtractor("youtube", "https://www.youtube.com/watch?v=abc123", {
			context: youtubeContext(),
		});

		expect(result.error).toBeUndefined();
		expect(result.data).toMatchObject({
			videoId: "abc123",
			title: "Test Video",
			description: "Video description",
			channel: "Test Channel",
			views: 12345,
			lengthSeconds: 99,
			commentCount: "12 Comments",
		});
		const data = result.data as {
			transcript?: { text: string; segments: unknown[] };
			comments?: Array<{ author?: string; text: string }>;
		};
		expect(data.transcript?.text).toContain("Hello & welcome");
		expect(data.transcript?.segments).toHaveLength(2);
		expect(data.comments?.[0]).toMatchObject({ author: "Ada", text: "Great explanation" });
	});

	it("supports youtu.be and shorts URLs", async () => {
		const short = await runVerticalExtractor("youtube", "https://youtu.be/abc123", {
			context: youtubeContext(),
		});
		const shorts = await runVerticalExtractor(
			"youtube",
			"https://www.youtube.com/shorts/abc123?lang=en",
			{ context: youtubeContext() },
		);

		expect(short.data).toMatchObject({ videoId: "abc123" });
		expect(shorts.data).toMatchObject({ videoId: "abc123" });
	});
});
