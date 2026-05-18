/** @file Extract verticals github-repo module. */
import { capability, type VerticalExtractor } from "../../vertical/capabilities.ts";
import type { VerticalExtractorContext } from "../../vertical/types.ts";

const README_MAX_CHARS = 10_000;

interface GitHubRepoApi {
	full_name: string;
	description?: string;
	html_url: string;
	stargazers_count: number;
	forks_count: number;
	open_issues_count: number;
	default_branch: string;
	license?: { spdx_id?: string; name?: string } | null;
	owner?: { login?: string };
}

interface GitHubReadmeApi {
	name: string;
	path: string;
	content: string;
	encoding: string;
	size: number;
}

interface GitHubTreeEntry {
	path: string;
	type: string;
	size?: number;
}

interface GitHubTreeApi {
	sha: string;
	url: string;
	tree: GitHubTreeEntry[];
	truncated: boolean;
}

interface FileTreeEntry {
	path: string;
	type: "blob" | "tree";
	size?: number;
}

interface GitHubRepoOutput {
	fullName: string;
	owner: string;
	name: string;
	description?: string;
	url: string;
	stars: number;
	forks: number;
	openIssues: number;
	defaultBranch: string;
	license?: string;
	readme?: string;
	readmeTruncated?: boolean;
	fileTree?: FileTreeEntry[];
}

export const githubRepoExtractor: VerticalExtractor<GitHubRepoOutput> = {
	capability: capability("github_repo", ["https://github.com/:owner/:repo"], {
		type: "object",
		required: ["fullName", "url", "stars"],
		properties: {
			fullName: { type: "string" },
			url: { type: "string" },
			stars: { type: "number" },
			readme: { type: "string" },
			readmeTruncated: { type: "boolean" },
			fileTree: {
				type: "array",
				items: {
					type: "object",
					properties: {
						path: { type: "string" },
						type: { enum: ["blob", "tree"] },
						size: { type: "number" },
					},
				},
			},
		},
	}),
	match: (url) => {
		if (url.hostname !== "github.com") return;
		const [owner, repo, ...rest] = url.pathname.split("/").filter(Boolean);
		return owner && repo && rest.length === 0 && !repo.includes(".") ? { owner, repo } : undefined;
	},
	extract: async (_url, match, context, signal) => {
		const encodedOwner = encodeURIComponent(match.owner);
		const encodedRepo = encodeURIComponent(match.repo);
		const baseUrl = `https://api.github.com/repos/${encodedOwner}/${encodedRepo}`;

		const [repoResult, readmeResult, treeResult] = await Promise.allSettled([
			context.fetchJson<GitHubRepoApi>(baseUrl, signal),
			fetchReadme(baseUrl, context, signal),
			fetchFileTree(baseUrl, context, signal),
		]);

		const repoData = settledValue(repoResult) ?? {
			full_name: `${match.owner}/${match.repo}`,
			html_url: `https://github.com/${match.owner}/${match.repo}`,
			stargazers_count: 0,
			forks_count: 0,
			open_issues_count: 0,
			default_branch: "main",
		};

		return {
			fullName: repoData.full_name,
			owner: repoData.owner?.login ?? match.owner,
			name: match.repo,
			description: repoData.description,
			url: repoData.html_url,
			stars: repoData.stargazers_count,
			forks: repoData.forks_count,
			openIssues: repoData.open_issues_count,
			defaultBranch: repoData.default_branch,
			license: repoData.license?.spdx_id ?? repoData.license?.name,
			...settledValue(readmeResult),
			...settledValue(treeResult),
		};
	},
};

async function fetchReadme(
	baseUrl: string,
	context: VerticalExtractorContext,
	signal?: AbortSignal,
): Promise<{ readme?: string; readmeTruncated?: boolean }> {
	try {
		const readme = await context.fetchJson<GitHubReadmeApi>(`${baseUrl}/readme`, signal);
		if (readme.encoding !== "base64" || !readme.content) return {};
		const decoded = atob(readme.content);
		if (decoded.length > README_MAX_CHARS) {
			return { readme: decoded.slice(0, README_MAX_CHARS), readmeTruncated: true };
		}
		return { readme: decoded };
	} catch {
		return {};
	}
}

async function fetchFileTree(
	baseUrl: string,
	context: VerticalExtractorContext,
	signal?: AbortSignal,
): Promise<{ fileTree?: FileTreeEntry[] } | undefined> {
	try {
		const tree = await context.fetchJson<GitHubTreeApi>(
			`${baseUrl}/git/trees/main?recursive=1`,
			signal,
		);
		if (tree.tree.length === 0) return;
		const filtered = tree.tree
			.filter((entry) => {
				const depth = entry.path.split("/").length;
				return depth <= 2 && (entry.type === "blob" || entry.type === "tree");
			})
			.map((entry) => ({
				path: entry.path,
				type: entry.type as "blob" | "tree",
				...(entry.size !== undefined ? { size: entry.size } : {}),
			}));
		return filtered.length > 0 ? { fileTree: filtered } : undefined;
	} catch {
		return {};
	}
}

function settledValue<T>(result: PromiseSettledResult<T>): T | undefined {
	return result.status === "fulfilled" ? result.value : undefined;
}
