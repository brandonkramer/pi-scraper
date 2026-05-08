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
import { docstringsExtractor } from "./verticals/docstrings.js";
import { docsiteExtractor } from "./verticals/docs-site.js";
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
import { redditExtractor } from "./verticals/reddit.js";

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
	redditExtractor,
	arxivExtractor,
	deepWikiExtractor,
	docsiteExtractor,
	docstringsExtractor,
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
			error: verticalError(error),
		};
	}
}

function verticalError(error: unknown): {
	code: string;
	message: string;
	retryable: boolean;
} {
	const structured = structuredError(error);
	if (structured) return structured;
	return {
		code: "EXTRACTION_FAILED",
		message:
			error instanceof Error ? error.message : "Vertical extraction failed",
		retryable: false,
	};
}

function structuredError(
	error: unknown,
): { code: string; message: string; retryable: boolean } | undefined {
	if (!error || typeof error !== "object") return undefined;
	const structured = (error as { structured?: unknown }).structured;
	if (!structured || typeof structured !== "object") return undefined;
	const code = (structured as { code?: unknown }).code;
	const message = (structured as { message?: unknown }).message;
	if (typeof code !== "string" || typeof message !== "string") return undefined;
	return {
		code,
		message,
		retryable: Boolean((structured as { retryable?: unknown }).retryable),
	};
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
		fetchPage: async (url: string, signal?: AbortSignal) => {
			recordVerticalSource(sources, url, "page");
			const response = await client.fetchUrl(
				url,
				{ forceText: true, respectRobots: true, ...requestOptions },
				signal,
			);
			return {
				text: response.text ?? response.body?.toString("utf8") ?? "",
				finalUrl: response.finalUrl,
				status: response.status,
				contentType: response.contentType,
			};
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
