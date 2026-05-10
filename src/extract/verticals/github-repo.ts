/**
 * @fileoverview extract verticals github-repo module.
 */
import { capability, type VerticalExtractor } from "../capabilities.ts";

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

export const githubRepoExtractor: VerticalExtractor = {
	capability: capability("github_repo", ["https://github.com/:owner/:repo"], {
		type: "object",
		required: ["fullName", "url", "stars"],
		properties: {
			fullName: { type: "string" },
			url: { type: "string" },
			stars: { type: "number" },
		},
	}),
	match: (url) => {
		if (url.hostname !== "github.com") return undefined;
		const [owner, repo, ...rest] = url.pathname.split("/").filter(Boolean);
		return owner && repo && rest.length === 0 && !repo.includes(".")
			? { owner, repo }
			: undefined;
	},
	extract: async (_url, match, context, signal) => {
		const repo = await context.fetchJson<GitHubRepoApi>(
			`https://api.github.com/repos/${match.owner}/${match.repo}`,
			signal,
		);
		return {
			fullName: repo.full_name,
			owner: repo.owner?.login ?? match.owner,
			name: match.repo,
			description: repo.description,
			url: repo.html_url,
			stars: repo.stargazers_count,
			forks: repo.forks_count,
			openIssues: repo.open_issues_count,
			defaultBranch: repo.default_branch,
			license: repo.license?.spdx_id ?? repo.license?.name,
		};
	},
};
