/** @file Extract verticals gitingest module. */
import { capability, type VerticalExtractor } from "../../vertical/capabilities.ts";

const CONTENT_MAX_CHARS = 50_000;
const TREE_MAX_CHARS = 20_000;
const forwardedQueryParams = ["max_file_size", "pattern_type", "pattern"] as const;

interface GitIngestApiResponse {
	repo_url?: string;
	short_repo_url?: string;
	summary?: string;
	digest_url?: string;
	tree?: string;
	content?: string;
	default_max_file_size?: number;
	pattern_type?: string;
	pattern?: string;
	error?: string;
}

interface GitIngestOutput {
	owner: string;
	repo: string;
	repoUrl?: string;
	shortRepoUrl?: string;
	summary?: string;
	description?: string;
	digestUrl?: string;
	tree?: string;
	treeTruncated?: boolean;
	content?: string;
	contentChars?: number;
	contentTruncated?: boolean;
	defaultMaxFileSizeKb?: number;
	patternType?: string;
	pattern?: string;
}

export const gitIngestExtractor: VerticalExtractor<GitIngestOutput> = {
	capability: capability(
		"gitingest",
		["https://github.com/:owner/:repo", "https://gitingest.com/:owner/:repo"],
		{
			type: "object",
			required: ["owner", "repo"],
			properties: {
				owner: { type: "string" },
				repo: { type: "string" },
				repoUrl: { type: "string" },
				shortRepoUrl: { type: "string" },
				summary: { type: "string" },
				digestUrl: { type: "string" },
				tree: { type: "string" },
				treeTruncated: { type: "boolean" },
				content: { type: "string" },
				contentChars: { type: "number" },
				contentTruncated: { type: "boolean" },
				defaultMaxFileSizeKb: { type: "number" },
				patternType: { type: "string" },
				pattern: { type: "string" },
			},
		},
	),
	match: (url) => {
		if (url.hostname !== "github.com" && url.hostname !== "gitingest.com") return;
		const [owner, repo, ...rest] = url.pathname.split("/").filter(Boolean);
		if (!owner || !repo || rest.length > 0) return;
		return { owner, repo };
	},
	extract: async (url, match, context, signal) => {
		const response = await context.fetchJson<GitIngestApiResponse>(
			gitIngestApiUrl(url, match.owner, match.repo),
			signal,
		);
		if (response.error) throw new Error(response.error);
		const tree = truncate(response.tree, TREE_MAX_CHARS);
		const content = truncate(response.content, CONTENT_MAX_CHARS);
		return {
			owner: match.owner,
			repo: match.repo,
			repoUrl: response.repo_url,
			shortRepoUrl: response.short_repo_url,
			summary: response.summary,
			description: firstSummaryLine(response.summary),
			digestUrl: response.digest_url,
			tree: tree.text,
			treeTruncated: tree.truncated || undefined,
			content: content.text,
			contentChars: response.content?.length,
			contentTruncated: content.truncated || undefined,
			defaultMaxFileSizeKb: response.default_max_file_size,
			patternType: response.pattern_type,
			pattern: response.pattern,
		};
	},
};

function gitIngestApiUrl(sourceUrl: URL, owner: string, repo: string): string {
	const apiUrl = new URL(
		`https://gitingest.com/api/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
	);
	for (const name of forwardedQueryParams) {
		const value = sourceUrl.searchParams.get(name);
		if (value) apiUrl.searchParams.set(name, value);
	}
	return apiUrl.toString();
}

function truncate(
	value: string | undefined,
	maxChars: number,
): { text?: string; truncated: boolean } {
	if (!value || value.length <= maxChars) return { text: value, truncated: false };
	return { text: value.slice(0, maxChars), truncated: true };
}

function firstSummaryLine(summary: string | undefined): string | undefined {
	return summary
		?.split("\n")
		.find((line) => line.trim())
		?.trim();
}
