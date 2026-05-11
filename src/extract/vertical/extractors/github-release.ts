/** @file Extract verticals github-release module. */
import { capability, type VerticalExtractor } from "../../vertical/capabilities.ts";

interface GitHubReleaseApi {
	tag_name: string;
	name?: string | null;
	html_url: string;
	draft?: boolean;
	prerelease?: boolean;
	author?: { login?: string };
	published_at?: string | null;
	created_at?: string;
	body?: string | null;
	assets?: Array<{
		name?: string;
		size?: number;
		download_count?: number;
		browser_download_url?: string;
	}>;
}

export const githubReleaseExtractor: VerticalExtractor = {
	capability: capability("github_release", ["https://github.com/:owner/:repo/releases/tag/:tag"], {
		type: "object",
		required: ["owner", "repo", "tag", "url"],
		properties: {
			owner: { type: "string" },
			repo: { type: "string" },
			tag: { type: "string" },
			name: { type: "string" },
			url: { type: "string" },
		},
	}),
	match: (url) => {
		if (url.hostname !== "github.com") return;
		const [owner, repo, releases, tagKeyword, ...tagParts] = url.pathname
			.split("/")
			.filter(Boolean);
		if (!owner || !repo || releases !== "releases" || tagKeyword !== "tag" || tagParts.length === 0)
			return;
		return { owner, repo, tag: decodeURIComponent(tagParts.join("/")) };
	},
	extract: async (_url, match, context, signal) => {
		const release = await context.fetchJson<GitHubReleaseApi>(
			`https://api.github.com/repos/${match.owner}/${match.repo}/releases/tags/${encodeURIComponent(match.tag)}`,
			signal,
		);
		return {
			owner: match.owner,
			repo: match.repo,
			tag: release.tag_name,
			name: release.name ?? undefined,
			url: release.html_url,
			draft: release.draft,
			prerelease: release.prerelease,
			author: release.author?.login,
			publishedAt: release.published_at,
			createdAt: release.created_at,
			body: release.body ?? undefined,
			assets: release.assets?.map((asset) => ({
				name: asset.name,
				size: asset.size,
				downloads: asset.download_count,
				url: asset.browser_download_url,
			})),
		};
	},
};
