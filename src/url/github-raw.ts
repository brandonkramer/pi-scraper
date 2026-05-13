/** @file GitHub blob URL to raw content URL normalization. */

export interface GitHubRawResult {
	originalUrl: string;
	rawUrl: string;
}

/**
 * Convert a GitHub blob URL to its raw.githubusercontent.com equivalent.
 *
 * Only transforms safe, recognized file URL shapes:
 * https://github.com/{owner}/{repo}/blob/{ref}/{path}
 *
 * Does not transform trees, issues, PRs, releases, or arbitrary GitHub pages.
 */
export function normalizeGitHubBlobUrl(input: string): GitHubRawResult | undefined {
	try {
		const url = new URL(input);
		if (url.hostname !== "github.com" && url.hostname !== "www.github.com") return;
		// Match /owner/repo/blob/ref/path... — ref may contain slashes in some edge cases,
		// but GitHub blob paths always have at least owner, repo, blob, ref, and one path segment.
		const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/(.+)$/u);
		if (!match) return;
		const [, owner, repo, refAndPath] = match;
		const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${refAndPath}`;
		return { originalUrl: input, rawUrl };
	} catch {
		// Malformed input is not a GitHub blob URL.
	}
}
