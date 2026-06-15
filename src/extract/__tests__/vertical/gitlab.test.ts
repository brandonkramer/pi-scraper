/** @file GitLab vertical extractor tests. */
import { describe, expect, it, vi } from "vitest";

import type { VerticalExtractorContext } from "../../vertical/capabilities.ts";
import { clearManifestRegistryCache } from "../../vertical/manifest-registry.ts";
import { matchUrlPattern } from "../../vertical/matcher.ts";
import { runVerticalExtractor } from "../../vertical/registry.ts";

const gitlabProject = {
	id: 123,
	name: "gitlab",
	name_with_namespace: "GitLab.org / GitLab",
	path_with_namespace: "gitlab-org/gitlab",
	description: "GitLab is an open source end-to-end software development platform",
	web_url: "https://gitlab.com/gitlab-org/gitlab",
	star_count: 5000,
	forks_count: 2000,
	open_issues_count: 300,
	default_branch: "main",
	visibility: "public",
	topics: ["devops", "ci-cd"],
};

const gitlabReadme = {
	file_name: "README.md",
	content: "R2l0TGFiIE1hcmtkb3duIFJFQURNRSBjb250ZW50",
	encoding: "base64",
};

const gitlabTree = [
	{ id: "abc", name: "README.md", type: "blob", path: "README.md" },
	{ id: "def", name: "src", type: "tree", path: "src" },
	{ id: "ghi", name: "lib", type: "tree", path: "lib" },
];

function gitlabContext(): VerticalExtractorContext {
	const fetchJson = vi.fn(async (url: string) => {
		if (url.includes("/api/v4/projects/")) {
			if (url.includes("/readme")) return gitlabReadme;
			if (url.includes("/repository/tree")) return gitlabTree;
			return gitlabProject;
		}
		throw new Error(`Unexpected URL: ${url}`);
	}) as VerticalExtractorContext["fetchJson"];
	return { fetchJson };
}

describe("gitlab vertical extractor", () => {
	it("matches gitlab.com URLs", () => {
		const match = matchUrlPattern(new URL("https://gitlab.com/gitlab-org/gitlab"), [
			"https://:host/:owner/:repo",
		]);
		expect(match).toEqual({ host: "gitlab.com", owner: "gitlab-org", repo: "gitlab" });
	});

	it("matches gitlab.com URLs with trailing slash", () => {
		const match = matchUrlPattern(new URL("https://gitlab.com/gitlab-org/gitlab/"), [
			"https://:host/:owner/:repo/",
		]);
		expect(match).toEqual({ host: "gitlab.com", owner: "gitlab-org", repo: "gitlab" });
	});

	it("matches self-hosted GitLab instance URLs via :host capture", () => {
		const match = matchUrlPattern(new URL("https://gitlab.example.com/myorg/myrepo"), [
			"https://:host/:owner/:repo",
		]);
		expect(match).toEqual({ host: "gitlab.example.com", owner: "myorg", repo: "myrepo" });
	});

	it("rejects non-matching path depth", () => {
		const match = matchUrlPattern(new URL("https://gitlab.com/foo"), [
			"https://:host/:owner/:repo",
		]);
		expect(match).toBeUndefined();
	});

	it("extracts project metadata from gitlab.com", async () => {
		clearManifestRegistryCache();
		const result = (await runVerticalExtractor("gitlab", "https://gitlab.com/gitlab-org/gitlab", {
			context: gitlabContext(),
		})) as { data: Record<string, unknown>; error?: unknown; extractor: string; url: string };
		expect(result.error).toBeUndefined();
		expect(result.data).toMatchObject({
			fullName: "GitLab.org / GitLab",
			owner: "gitlab-org",
			name: "gitlab",
			stars: 5000,
			forks: 2000,
			openIssues: 300,
			visibility: "public",
			topics: ["devops", "ci-cd"],
			readme: "GitLab Markdown README content",
		});
		expect(result.data).toHaveProperty("fileTree");
		expect(Array.isArray(result.data.fileTree)).toBe(true);
	});

	it("extracts project metadata from self-hosted GitLab", async () => {
		clearManifestRegistryCache();
		const result = (await runVerticalExtractor(
			"gitlab",
			"https://gitlab.internal.company.com/team/project",
			{ context: gitlabContext() },
		)) as { data: Record<string, unknown>; error?: unknown; extractor: string; url: string };
		expect(result.error).toBeUndefined();
		expect(result.data).toMatchObject({
			owner: "team",
			name: "gitlab",
			stars: 5000,
		});
	});
});
