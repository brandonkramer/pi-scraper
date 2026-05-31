/** @file Tests for the GitHub repo vertical extractor (README + file tree). */
import { describe, expect, it, vi } from "vitest";

import type { VerticalExtractorContext } from "../../vertical/capabilities.ts";
import {
	buildManifestRegistry,
	clearManifestRegistryCache,
} from "../../vertical/manifest-registry.ts";
import { runVerticalExtractor } from "../../vertical/registry.ts";

const signal = new AbortController().signal;

interface GitHubRepoTestResult {
	fullName?: string;
	owner?: string;
	name?: string;
	description?: string;
	url?: string;
	stars?: number;
	forks?: number;
	openIssues?: number;
	defaultBranch?: string;
	license?: string;
	readme?: string;
	readmeTruncated?: boolean;
	fileTree?: Array<{ path: string; type: string; size?: number }>;
}

type FetchOutcome = { kind: "resolve"; value: unknown } | { kind: "reject"; error: Error };

function repoMetadata(overrides: Record<string, unknown> = {}) {
	return {
		full_name: "owner/repo",
		description: "A test repo",
		html_url: "https://github.com/owner/repo",
		stargazers_count: 100,
		forks_count: 20,
		open_issues_count: 5,
		default_branch: "main",
		owner: { login: "owner" },
		license: { spdx_id: "MIT", name: "MIT License" },
		...overrides,
	};
}

function ok(value: unknown): FetchOutcome {
	return { kind: "resolve", value };
}

function fail(message: string): FetchOutcome {
	return { kind: "reject", error: new Error(message) };
}

function githubRepoContext(
	...outcomes: FetchOutcome[]
): Pick<VerticalExtractorContext, "fetchJson"> {
	const fetchJson = vi.fn();
	for (const outcome of outcomes) {
		if (outcome.kind === "resolve") fetchJson.mockResolvedValueOnce(outcome.value);
		else fetchJson.mockRejectedValueOnce(outcome.error);
	}
	return { fetchJson };
}

function readmeResponse(content: string) {
	return {
		content: btoa(content),
		encoding: "base64",
		size: content.length,
		name: "README.md",
		path: "README.md",
	};
}

function emptyTreeResponse() {
	return { sha: "abc", url: "", tree: [], truncated: false };
}

async function extractGithubRepo(
	ctx: Pick<VerticalExtractorContext, "fetchJson">,
): Promise<GitHubRepoTestResult> {
	const result = await runVerticalExtractor(
		"github_repo",
		new URL("https://github.com/owner/repo"),
		{ context: ctx },
		signal,
	);
	if (result.error) throw new Error(result.error.message);
	return result.data as GitHubRepoTestResult;
}

describe("github_repo manifest match", () => {
	it("matches github.com/:owner/:repo", async () => {
		clearManifestRegistryCache();
		const registry = await buildManifestRegistry(false);
		const result = registry.match(new URL("https://github.com/facebook/react"));
		expect(result?.entry.manifest.name).toBe("github_repo");
		expect(result?.captures).toEqual({ owner: "facebook", repo: "react" });
	});

	it("does not select github_repo for non-github hosts", async () => {
		clearManifestRegistryCache();
		const registry = await buildManifestRegistry(false);
		expect(registry.match(new URL("https://gitlab.com/owner/repo"))?.entry.manifest.name).not.toBe(
			"github_repo",
		);
	});

	it("does not select github_repo for paths with extra segments", async () => {
		clearManifestRegistryCache();
		const registry = await buildManifestRegistry(false);
		expect(
			registry.match(new URL("https://github.com/owner/repo/issues/1"))?.entry.manifest.name,
		).not.toBe("github_repo");
	});
});

describe("github_repo manifest extract — README", () => {
	it("fetches and base64-decodes README", async () => {
		const ctx = githubRepoContext(
			ok(repoMetadata()),
			ok(readmeResponse("# Hello\nWorld")),
			ok(emptyTreeResponse()),
		);

		const result = await extractGithubRepo(ctx);

		expect(result.readme).toBe("# Hello\nWorld");
		expect(result.readmeTruncated).toBeUndefined();
		expect(result.fullName).toBe("owner/repo");
	});

	it("truncates README at 10k chars and sets flag", async () => {
		const longContent = "x".repeat(15_000);
		const ctx = githubRepoContext(
			ok(repoMetadata()),
			ok(readmeResponse(longContent)),
			ok(emptyTreeResponse()),
		);

		const result = await extractGithubRepo(ctx);

		expect(result.readme).toBe("x".repeat(10_000));
		expect(result.readmeTruncated).toBe(true);
	});

	it("handles README under 10k without truncation flag", async () => {
		const shortContent = "y".repeat(500);
		const ctx = githubRepoContext(
			ok(repoMetadata()),
			ok(readmeResponse(shortContent)),
			ok(emptyTreeResponse()),
		);

		const result = await extractGithubRepo(ctx);

		expect(result.readme).toBe("y".repeat(500));
		expect(result.readmeTruncated).toBeUndefined();
	});

	it("handles 404 README gracefully", async () => {
		const ctx = githubRepoContext(ok(repoMetadata()), fail("Not Found"), ok(emptyTreeResponse()));

		const result = await extractGithubRepo(ctx);

		expect(result.readme).toBeUndefined();
		expect(result.readmeTruncated).toBeUndefined();
		// Metadata still returned.
		expect(result.fullName).toBe("owner/repo");
	});
});

describe("github_repo manifest extract — file tree", () => {
	it("fetches and depth-filters file tree (depth ≤ 2)", async () => {
		const ctx = githubRepoContext(
			ok(repoMetadata()),
			fail("Not Found"),
			ok({
				sha: "abc",
				url: "",
				truncated: false,
				tree: [
					{ path: "src", type: "tree", size: 0 },
					{ path: "src/index.ts", type: "blob", size: 500 },
					{ path: "src/components", type: "tree", size: 0 },
					{ path: "src/components/Button.tsx", type: "blob", size: 200 },
					{ path: "package.json", type: "blob", size: 100 },
					{ path: "src/components/Button/Button.test.tsx", type: "blob", size: 300 },
					{ path: "src/deep/path/to/nested/file.ts", type: "blob", size: 50 },
				],
			}),
		);

		const result = await extractGithubRepo(ctx);

		expect(result.fileTree).toBeDefined();
		expect(result.fileTree!.length).toBe(4);
		// All entries should have depth ≤ 2
		for (const entry of result.fileTree!) {
			const depth = entry.path.split("/").length;
			expect(depth).toBeLessThanOrEqual(2);
		}
		// Depth-1 entries
		expect(result.fileTree).toEqual(
			expect.arrayContaining([
				{ path: "src", type: "tree", size: 0 },
				{ path: "package.json", type: "blob", size: 100 },
			]),
		);
		// Depth-2 entries
		expect(result.fileTree).toEqual(
			expect.arrayContaining([
				{ path: "src/index.ts", type: "blob", size: 500 },
				{ path: "src/components", type: "tree", size: 0 },
			]),
		);
		// Depth-3+ entries should NOT be present
		expect(result.fileTree!.find((e) => e.path === "src/components/Button.tsx")).toBeUndefined();
		expect(
			result.fileTree!.find((e) => e.path === "src/deep/path/to/nested/file.ts"),
		).toBeUndefined();
	});

	it("handles 403/404 file tree gracefully", async () => {
		const ctx = githubRepoContext(ok(repoMetadata()), fail("Not Found"), fail("Forbidden"));

		const result = await extractGithubRepo(ctx);

		expect(result.fileTree).toBeUndefined();
		// Metadata still returned.
		expect(result.fullName).toBe("owner/repo");
	});
});

describe("github_repo manifest extract — backward compat", () => {
	it("returns existing metadata fields unchanged", async () => {
		const ctx = githubRepoContext(ok(repoMetadata()), fail("Not Found"), ok(emptyTreeResponse()));

		const result = await extractGithubRepo(ctx);

		expect(result.fullName).toBe("owner/repo");
		expect(result.owner).toBe("owner");
		expect(result.name).toBe("repo");
		expect(result.description).toBe("A test repo");
		expect(result.url).toBe("https://github.com/owner/repo");
		expect(result.stars).toBe(100);
		expect(result.forks).toBe(20);
		expect(result.openIssues).toBe(5);
		expect(result.defaultBranch).toBe("main");
		expect(result.license).toBe("MIT");
	});
});
