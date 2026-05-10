/**
 * @fileoverview extract __tests__ ossinsight.test module.
 */
import { describe, expect, it } from "vitest";
import type { VerticalExtractorContext } from "../vertical/capabilities.ts";
import { runVerticalExtractor } from "../vertical/registry.ts";
import { ossInsightCollectionRankingExtractor } from "../vertical/extractors/ossinsight-collection-ranking.ts";
import { ossInsightCollectionsExtractor } from "../vertical/extractors/ossinsight-collections.ts";
import { ossInsightRepoAnalyticsExtractor } from "../vertical/extractors/ossinsight-repo-analytics.ts";
import { ossInsightTrendingReposExtractor } from "../vertical/extractors/ossinsight-trending-repos.ts";

function ossInsightContext(calls: string[] = []): VerticalExtractorContext {
	return {
		fetchJson: async <T>(url: string) => {
			calls.push(url);
			if (url === "https://api.ossinsight.io/v1/collections/") {
				return {
					data: {
						rows: [
							{ id: "2", name: "Open Source Database" },
							{ id: 10098, name: "AI Agent Frameworks" },
						],
					},
				} as T;
			}
			if (url.includes("/collections/2/ranking_by_stars/")) {
				return {
					data: {
						rows: [
							{
								repo_name: "pingcap/tidb",
								stars: "38000",
								forks: "6000",
								total_score: "88.5",
								ignored: "trim me",
							},
						],
					},
				} as T;
			}
			if (url.includes("/collections/10098/ranking_by_prs/")) {
				return {
					data: {
						rows: [{ repo_name: "langchain-ai/langchain", pull_requests: 21 }],
					},
				} as T;
			}
			if (url.includes("/trends/repos/")) {
				return {
					data: {
						rows: [
							{
								repo_name: "ruvnet/ruflo",
								primary_language: "TypeScript",
								description: "Agent orchestration",
								stars: "544",
								forks: "55",
								pull_requests: "2",
								pushes: "41",
								total_score: "2301.8",
								ignored: "trim me",
							},
						],
					},
				} as T;
			}
			if (url.includes("/repos/pingcap/tidb/stargazers/history/")) {
				return {
					data: {
						rows: [
							{ date: "2015-09-01", stargazers: "2466" },
							{ event_month: "2015-10-01", stars: 456, total: "2922" },
						],
					},
				} as T;
			}
			throw new Error(`Unexpected OSSInsight API URL: ${url}`);
		},
	};
}

describe("OSSInsight vertical extractors", () => {
	it("matches only documented OSSInsight URL shapes", () => {
		expect(
			ossInsightCollectionsExtractor.match(
				new URL("https://ossinsight.io/collections"),
			),
		).toEqual({});
		expect(
			ossInsightCollectionsExtractor.match(
				new URL("https://ossinsight.io/collections/"),
			),
		).toEqual({});
		expect(
			ossInsightCollectionsExtractor.match(
				new URL("https://ossinsight.io/collections/open-source-database"),
			),
		).toBeUndefined();

		expect(
			ossInsightCollectionRankingExtractor.match(
				new URL(
					"https://ossinsight.io/collections/open-source-database?metric=issues&period=past_month",
				),
			),
		).toEqual({
			slug: "open-source-database",
			metric: "issues",
			period: "past_month",
		});
		expect(
			ossInsightCollectionRankingExtractor.match(
				new URL("https://ossinsight.io/collections/open-source-database/extra"),
			),
		).toBeUndefined();
		expect(
			ossInsightCollectionRankingExtractor.match(
				new URL(
					"https://ossinsight.io/collections/open-source-database?metric=forks",
				),
			),
		).toBeUndefined();

		expect(
			ossInsightTrendingReposExtractor.match(
				new URL("https://ossinsight.io/trending"),
			),
		).toEqual({ language: "All", period: "past_24_hours" });
		expect(
			ossInsightTrendingReposExtractor.match(
				new URL("https://ossinsight.io/trending/TypeScript?period=past_week"),
			),
		).toEqual({ language: "TypeScript", period: "past_week" });
		expect(
			ossInsightTrendingReposExtractor.match(
				new URL("https://ossinsight.io/trending/TypeScript/extra"),
			),
		).toBeUndefined();

		expect(
			ossInsightRepoAnalyticsExtractor.match(
				new URL("https://ossinsight.io/analyze/pingcap/tidb"),
			),
		).toEqual({ owner: "pingcap", repo: "tidb" });
		expect(
			ossInsightRepoAnalyticsExtractor.match(
				new URL("https://ossinsight.io/analyze/pingcap"),
			),
		).toBeUndefined();
	});

	it("extracts collections through the documented public API", async () => {
		await expect(
			runVerticalExtractor(
				"ossinsight_collections",
				"https://ossinsight.io/collections",
				{
					context: ossInsightContext(),
				},
			),
		).resolves.toMatchObject({
			data: {
				collections: [
					{ id: "2", name: "Open Source Database" },
					{ id: 10098, name: "AI Agent Frameworks" },
				],
			},
		});
	});

	it("resolves collection slugs once and trims ranking rows", async () => {
		const calls: string[] = [];
		const result = await runVerticalExtractor(
			"ossinsight_collection_ranking",
			"https://ossinsight.io/collections/open-source-database",
			{ context: ossInsightContext(calls) },
		);
		expect(result.error).toBeUndefined();
		expect(result.data).toEqual({
			collection: {
				id: "2",
				name: "Open Source Database",
				slug: "open-source-database",
			},
			metric: "stars",
			period: "past_28_days",
			rows: [
				{
					repo_name: "pingcap/tidb",
					stars: "38000",
					forks: "6000",
					total_score: "88.5",
				},
			],
		});
		expect(
			calls.filter((url) => url.endsWith("/v1/collections/")),
		).toHaveLength(1);
		expect(calls[1]).toBe(
			"https://api.ossinsight.io/v1/collections/2/ranking_by_stars/?period=past_28_days",
		);
	});

	it("supports collection ranking metric and period query parameters", async () => {
		await expect(
			runVerticalExtractor(
				"ossinsight_collection_ranking",
				"https://ossinsight.io/collections/ai-agent-frameworks?metric=pull-requests&period=past_24_hours",
				{ context: ossInsightContext() },
			),
		).resolves.toMatchObject({
			data: {
				collection: { id: 10098, slug: "ai-agent-frameworks" },
				metric: "pull-requests",
				period: "past_24_hours",
				rows: [{ repo_name: "langchain-ai/langchain", pull_requests: 21 }],
			},
		});
	});

	it("fails gracefully when a collection slug is unknown", async () => {
		await expect(
			runVerticalExtractor(
				"ossinsight_collection_ranking",
				"https://ossinsight.io/collections/not-real",
				{ context: ossInsightContext() },
			),
		).resolves.toMatchObject({
			error: {
				code: "EXTRACTION_FAILED",
				message: "Unknown OSSInsight collection slug: not-real",
			},
		});
	});

	it("extracts trending repositories", async () => {
		await expect(
			runVerticalExtractor(
				"ossinsight_trending_repos",
				"https://ossinsight.io/trending/TypeScript?period=past_week",
				{ context: ossInsightContext() },
			),
		).resolves.toMatchObject({
			data: {
				period: "past_week",
				language: "TypeScript",
				rows: [
					{
						repo_name: "ruvnet/ruflo",
						primary_language: "TypeScript",
						description: "Agent orchestration",
						stars: "544",
						forks: "55",
						pull_requests: "2",
						pushes: "41",
						total_score: "2301.8",
					},
				],
			},
		});
	});

	it("extracts repository stargazer history analytics", async () => {
		await expect(
			runVerticalExtractor(
				"ossinsight_repo_analytics",
				"https://ossinsight.io/analyze/pingcap/tidb",
				{ context: ossInsightContext() },
			),
		).resolves.toMatchObject({
			data: {
				owner: "pingcap",
				repo: "tidb",
				stargazers: [
					{ event_month: "2015-09-01", total: 2466 },
					{ event_month: "2015-10-01", stars: 456, total: 2922 },
				],
			},
		});
	});
});
