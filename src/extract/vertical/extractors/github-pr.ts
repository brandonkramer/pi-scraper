/** @file Extract verticals github-pr module. */
import { capability, type VerticalExtractor } from "../../vertical/capabilities.ts";

interface GitHubPullApi {
	number: number;
	title: string;
	html_url: string;
	state: string;
	draft?: boolean;
	merged?: boolean;
	user?: { login?: string };
	base?: { ref?: string; repo?: { full_name?: string } };
	head?: { ref?: string; repo?: { full_name?: string } };
	additions?: number;
	deletions?: number;
	changed_files?: number;
	created_at?: string;
	updated_at?: string;
	closed_at?: string | null;
	merged_at?: string | null;
}

export const githubPrExtractor: VerticalExtractor = {
	capability: capability("github_pr", ["https://github.com/:owner/:repo/pull/:number"], {
		type: "object",
		required: ["owner", "repo", "number", "title", "state", "url"],
		properties: {
			owner: { type: "string" },
			repo: { type: "string" },
			number: { type: "number" },
			title: { type: "string" },
			state: { type: "string" },
			url: { type: "string" },
		},
	}),
	match: (url) => {
		if (url.hostname !== "github.com") return;
		const [owner, repo, type, number, ...rest] = url.pathname.split("/").filter(Boolean);
		if (!owner || !repo || type !== "pull" || !number || rest.length > 0 || !/^\d+$/u.test(number))
			return;
		return { owner, repo, number };
	},
	extract: async (_url, match, context, signal) => {
		const pull = await context.fetchJson<GitHubPullApi>(
			`https://api.github.com/repos/${match.owner}/${match.repo}/pulls/${match.number}`,
			signal,
		);
		return {
			owner: match.owner,
			repo: match.repo,
			number: pull.number,
			title: pull.title,
			state: pull.state,
			url: pull.html_url,
			author: pull.user?.login,
			draft: pull.draft,
			merged: pull.merged,
			baseRef: pull.base?.ref,
			baseRepo: pull.base?.repo?.full_name,
			headRef: pull.head?.ref,
			headRepo: pull.head?.repo?.full_name,
			additions: pull.additions,
			deletions: pull.deletions,
			changedFiles: pull.changed_files,
			createdAt: pull.created_at,
			updatedAt: pull.updated_at,
			closedAt: pull.closed_at,
			mergedAt: pull.merged_at,
		};
	},
};
