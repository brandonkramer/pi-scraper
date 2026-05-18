/** @file Tests for the GitHub repo vertical extractor (README + file tree). */
import { describe, expect, it, vi } from "vitest";

import { githubRepoExtractor } from "../github-repo.ts";

const signal = new AbortController().signal;

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

describe("githubRepoExtractor.match", () => {
	it("matches github.com/:owner/:repo", () => {
		const result = githubRepoExtractor.match(new URL("https://github.com/facebook/react"));
		expect(result).toEqual({ owner: "facebook", repo: "react" });
	});

	it("rejects non-github hosts", () => {
		expect(githubRepoExtractor.match(new URL("https://gitlab.com/owner/repo"))).toBeUndefined();
	});

	it("rejects github.com paths with extra segments", () => {
		expect(
			githubRepoExtractor.match(new URL("https://github.com/owner/repo/issues/1")),
		).toBeUndefined();
	});
});

describe("githubRepoExtractor.extract — README", () => {
	it("fetches and base64-decodes README", async () => {
		let callIndex = 0;
		const ctx = {
			fetchJson: vi.fn().mockImplementation(async () => {
				callIndex++;
				if (callIndex === 1) return repoMetadata();
				if (callIndex === 2)
					return {
						content: btoa("# Hello\nWorld"),
						encoding: "base64",
						size: 14,
						name: "README.md",
						path: "README.md",
					};
				return { sha: "abc", url: "", tree: [], truncated: false };
			}),
		};

		const result = await githubRepoExtractor.extract(
			new URL("https://github.com/owner/repo"),
			{ owner: "owner", repo: "repo" },
			ctx as Parameters<typeof githubRepoExtractor.extract>[2],
			signal,
		);

		expect(result.readme).toBe("# Hello\nWorld");
		expect(result.readmeTruncated).toBeUndefined();
		expect(result.fullName).toBe("owner/repo");
	});

	it("truncates README at 10k chars and sets flag", async () => {
		const longContent = "x".repeat(15_000);
		let callIndex = 0;
		const ctx = {
			fetchJson: vi.fn().mockImplementation(async () => {
				callIndex++;
				if (callIndex === 1) return repoMetadata();
				if (callIndex === 2)
					return {
						content: btoa(longContent),
						encoding: "base64",
						size: 15_000,
						name: "README.md",
						path: "README.md",
					};
				return { sha: "abc", url: "", tree: [], truncated: false };
			}),
		};

		const result = await githubRepoExtractor.extract(
			new URL("https://github.com/owner/repo"),
			{ owner: "owner", repo: "repo" },
			ctx as Parameters<typeof githubRepoExtractor.extract>[2],
			signal,
		);

		expect(result.readme).toBe("x".repeat(10_000));
		expect(result.readmeTruncated).toBe(true);
	});

	it("handles README under 10k without truncation flag", async () => {
		const shortContent = "y".repeat(500);
		let callIndex = 0;
		const ctx = {
			fetchJson: vi.fn().mockImplementation(async () => {
				callIndex++;
				if (callIndex === 1) return repoMetadata();
				if (callIndex === 2)
					return {
						content: btoa(shortContent),
						encoding: "base64",
						size: 500,
						name: "README.md",
						path: "README.md",
					};
				return { sha: "abc", url: "", tree: [], truncated: false };
			}),
		};

		const result = await githubRepoExtractor.extract(
			new URL("https://github.com/owner/repo"),
			{ owner: "owner", repo: "repo" },
			ctx as Parameters<typeof githubRepoExtractor.extract>[2],
			signal,
		);

		expect(result.readme).toBe("y".repeat(500));
		expect(result.readmeTruncated).toBeUndefined();
	});

	it("handles 404 README gracefully", async () => {
		let callIndex = 0;
		const ctx = {
			fetchJson: vi.fn().mockImplementation(async () => {
				callIndex++;
				if (callIndex === 1) return repoMetadata();
				if (callIndex === 2) throw new Error("Not Found");
				return { sha: "abc", url: "", tree: [], truncated: false };
			}),
		};

		const result = await githubRepoExtractor.extract(
			new URL("https://github.com/owner/repo"),
			{ owner: "owner", repo: "repo" },
			ctx as Parameters<typeof githubRepoExtractor.extract>[2],
			signal,
		);

		expect(result.readme).toBeUndefined();
		expect(result.readmeTruncated).toBeUndefined();
		expect(result.fullName).toBe("owner/repo"); // metadata still returned
	});
});

describe("githubRepoExtractor.extract — file tree", () => {
	it("fetches and depth-filters file tree (depth ≤ 2)", async () => {
		let callIndex = 0;
		const ctx = {
			fetchJson: vi.fn().mockImplementation(async () => {
				callIndex++;
				if (callIndex === 1) return repoMetadata();
				if (callIndex === 2) throw new Error("Not Found"); // no readme
				return {
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
				};
			}),
		};

		const result = await githubRepoExtractor.extract(
			new URL("https://github.com/owner/repo"),
			{ owner: "owner", repo: "repo" },
			ctx as Parameters<typeof githubRepoExtractor.extract>[2],
			signal,
		);

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
		let callIndex = 0;
		const ctx = {
			fetchJson: vi.fn().mockImplementation(async () => {
				callIndex++;
				if (callIndex === 1) return repoMetadata();
				if (callIndex === 2) throw new Error("Not Found");
				if (callIndex === 3) throw new Error("Forbidden");
				throw new Error("unexpected");
			}),
		};

		const result = await githubRepoExtractor.extract(
			new URL("https://github.com/owner/repo"),
			{ owner: "owner", repo: "repo" },
			ctx as Parameters<typeof githubRepoExtractor.extract>[2],
			signal,
		);

		expect(result.fileTree).toBeUndefined();
		expect(result.fullName).toBe("owner/repo"); // metadata still returned
	});
});

describe("githubRepoExtractor.extract — backward compat", () => {
	it("returns existing metadata fields unchanged", async () => {
		let callIndex = 0;
		const ctx = {
			fetchJson: vi.fn().mockImplementation(async () => {
				callIndex++;
				if (callIndex === 1) return repoMetadata();
				if (callIndex === 2) throw new Error("Not Found");
				return { sha: "abc", url: "", tree: [], truncated: false };
			}),
		};

		const result = await githubRepoExtractor.extract(
			new URL("https://github.com/owner/repo"),
			{ owner: "owner", repo: "repo" },
			ctx as Parameters<typeof githubRepoExtractor.extract>[2],
			signal,
		);

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
