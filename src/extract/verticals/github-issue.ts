/**
 * @fileoverview extract verticals github-issue module.
 */
import { capability, type VerticalExtractor } from "../capabilities.ts";

interface GitHubIssueApi {
	number: number;
	title: string;
	html_url: string;
	state: string;
	user?: { login?: string };
	labels?: Array<{ name?: string }>;
	comments?: number;
	created_at?: string;
	updated_at?: string;
	closed_at?: string | null;
	pull_request?: unknown;
}

export const githubIssueExtractor: VerticalExtractor = {
	capability: capability(
		"github_issue",
		["https://github.com/:owner/:repo/issues/:number"],
		{
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
		},
	),
	match: (url) => {
		if (url.hostname !== "github.com") return undefined;
		const [owner, repo, type, number, ...rest] = url.pathname
			.split("/")
			.filter(Boolean);
		if (
			!owner ||
			!repo ||
			type !== "issues" ||
			!number ||
			rest.length > 0 ||
			!/^\d+$/u.test(number)
		)
			return undefined;
		return { owner, repo, number };
	},
	extract: async (_url, match, context, signal) => {
		const issue = await context.fetchJson<GitHubIssueApi>(
			`https://api.github.com/repos/${match.owner}/${match.repo}/issues/${match.number}`,
			signal,
		);
		return {
			owner: match.owner,
			repo: match.repo,
			number: issue.number,
			title: issue.title,
			state: issue.state,
			url: issue.html_url,
			author: issue.user?.login,
			labels: issue.labels
				?.map((label) => label.name)
				.filter((name): name is string => Boolean(name)),
			comments: issue.comments,
			createdAt: issue.created_at,
			updatedAt: issue.updated_at,
			closedAt: issue.closed_at,
			isPullRequest: Boolean(issue.pull_request),
		};
	},
};
