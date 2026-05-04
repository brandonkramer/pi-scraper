import { createHttpClient, type HttpClient } from "../http/client.js";
import type {
	CommonRequestOptions,
	ExtractorCapability,
	SourceReference,
} from "../types.js";
import type {
	VerticalExtractionResult,
	VerticalExtractor,
	VerticalExtractorContext,
} from "./capabilities.js";
import { arxivExtractor } from "./verticals/arxiv.js";
import { cratesIoExtractor } from "./verticals/crates-io.js";
import { deepWikiExtractor } from "./verticals/deepwiki.js";
import { dockerHubExtractor } from "./verticals/docker-hub.js";
import { githubIssueExtractor } from "./verticals/github-issue.js";
import { githubPrExtractor } from "./verticals/github-pr.js";
import { githubReleaseExtractor } from "./verticals/github-release.js";
import { githubRepoExtractor } from "./verticals/github-repo.js";
import { hackerNewsItemExtractor } from "./verticals/hackernews.js";
import {
	huggingFaceDatasetExtractor,
	huggingFaceModelExtractor,
} from "./verticals/huggingface.js";
import { npmPackageExtractor } from "./verticals/npm.js";
import { ossInsightCollectionRankingExtractor } from "./verticals/ossinsight-collection-ranking.js";
import { ossInsightCollectionsExtractor } from "./verticals/ossinsight-collections.js";
import { ossInsightRepoAnalyticsExtractor } from "./verticals/ossinsight-repo-analytics.js";
import { ossInsightTrendingReposExtractor } from "./verticals/ossinsight-trending-repos.js";
import { pypiPackageExtractor } from "./verticals/pypi.js";

export const verticalExtractors = [
	githubRepoExtractor,
	githubIssueExtractor,
	githubPrExtractor,
	githubReleaseExtractor,
	npmPackageExtractor,
	pypiPackageExtractor,
	cratesIoExtractor,
	dockerHubExtractor,
	huggingFaceModelExtractor,
	huggingFaceDatasetExtractor,
	hackerNewsItemExtractor,
	arxivExtractor,
	deepWikiExtractor,
	ossInsightCollectionsExtractor,
	ossInsightCollectionRankingExtractor,
	ossInsightTrendingReposExtractor,
	ossInsightRepoAnalyticsExtractor,
] as const satisfies readonly VerticalExtractor[];

export interface VerticalRegistryDeps {
	context?: VerticalExtractorContext;
	httpClient?: Pick<HttpClient, "fetchUrl">;
	requestOptions?: Pick<
		CommonRequestOptions,
		"cacheTtlSeconds" | "maxAgeSeconds" | "refresh"
	>;
}

export function listExtractorCapabilities(): ExtractorCapability[] {
	return verticalExtractors.map((extractor) => extractor.capability);
}

export async function runVerticalExtractor<T = unknown>(
	name: string,
	input: string | URL,
	deps: VerticalRegistryDeps = {},
	signal?: AbortSignal,
): Promise<VerticalExtractionResult<T>> {
	const url = new URL(input.toString());
	const extractor = verticalExtractors.find(
		(candidate) => candidate.capability.name === name,
	);
	if (!extractor)
		return {
			extractor: name,
			url: url.toString(),
			error: {
				code: "EXTRACTOR_NOT_FOUND",
				message: `Unknown extractor: ${name}`,
				retryable: false,
			},
		};
	const match = extractor.match(url);
	if (!match)
		return {
			extractor: name,
			url: url.toString(),
			error: {
				code: "URL_NOT_SUPPORTED",
				message: `${name} does not support this URL`,
				retryable: false,
			},
		};
	const sources: SourceReference[] = [];
	try {
		const data = await extractor.extract(
			url,
			match,
			deps.context ??
				httpContext(deps.httpClient, deps.requestOptions, sources),
			signal,
		);
		return {
			extractor: name,
			url: url.toString(),
			data: data as T,
			sources: sources.length ? sources : undefined,
		};
	} catch (error) {
		return {
			extractor: name,
			url: url.toString(),
			sources: sources.length ? sources : undefined,
			error: {
				code: "EXTRACTION_FAILED",
				message:
					error instanceof Error ? error.message : "Vertical extraction failed",
				retryable: false,
			},
		};
	}
}

function httpContext(
	client: Pick<HttpClient, "fetchUrl"> = createHttpClient(),
	requestOptions: Pick<
		CommonRequestOptions,
		"cacheTtlSeconds" | "maxAgeSeconds" | "refresh"
	> = {},
	sources: SourceReference[] = [],
): VerticalExtractorContext {
	return {
		fetchJson: async <T>(url: string, signal?: AbortSignal) => {
			recordVerticalSource(sources, url, "api");
			const response = await client.fetchUrl(
				url,
				{
					forceText: true,
					respectRobots: false,
					headers: { accept: "application/json" },
					...requestOptions,
				},
				signal,
			);
			return JSON.parse(response.text ?? "null") as T;
		},
		fetchText: async (url: string, signal?: AbortSignal) => {
			recordVerticalSource(sources, url, "feed");
			const response = await client.fetchUrl(
				url,
				{ forceText: true, respectRobots: false, ...requestOptions },
				signal,
			);
			return response.text ?? "";
		},
	};
}

function recordVerticalSource(
	sources: SourceReference[],
	url: string,
	provider: string,
): void {
	if (sources.some((source) => source.url === url)) return;
	sources.push({
		id: `source-${sources.length + 1}`,
		url,
		provider,
		accessedAt: new Date().toISOString(),
	});
}
