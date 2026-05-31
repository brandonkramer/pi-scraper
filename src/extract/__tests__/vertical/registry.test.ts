/** @file Extract **tests** registry.test module. */
import { describe, expect, it } from "vitest";

import type { VerticalExtractorContext } from "../../vertical/capabilities.ts";
import { listExtractorCapabilities, runVerticalExtractor } from "../../vertical/registry.ts";

const context: VerticalExtractorContext = {
	fetchJson: async <T>(url: string) => {
		if (url.includes("/issues/7")) {
			return {
				number: 7,
				title: "Bug",
				html_url: "https://github.com/mario/pi/issues/7",
				state: "open",
				user: { login: "octo" },
				labels: [{ name: "bug" }],
				comments: 2,
			} as T;
		}
		if (url.includes("/pulls/8")) {
			return {
				number: 8,
				title: "Patch",
				html_url: "https://github.com/mario/pi/pull/8",
				state: "open",
				merged: false,
				base: { ref: "main" },
				head: { ref: "fix" },
				additions: 10,
				deletions: 1,
				changed_files: 2,
			} as T;
		}
		if (url.includes("/releases/tags/")) {
			return {
				tag_name: "v1.0.0",
				name: "One",
				html_url: "https://github.com/mario/pi/releases/tag/v1.0.0",
				draft: false,
				prerelease: false,
				assets: [
					{
						name: "pi.tgz",
						size: 123,
						download_count: 4,
						browser_download_url: "https://example.com/pi.tgz",
					},
				],
			} as T;
		}
		if (url.includes("gitingest.com/api")) {
			expect(url).toBe(
				"https://gitingest.com/api/mario/pi?max_file_size=50&pattern_type=include&pattern=src%2F**%2F*.ts",
			);
			return {
				repo_url: "mario/pi",
				short_repo_url: "mario/pi",
				summary: "Repository: mario/pi\nFiles analyzed: 1\n\nEstimated tokens: 1.0k",
				digest_url: "https://example.com/mario-pi.txt",
				tree: "Directory structure:\n└── src/api.ts",
				content: "FILE: src/api.ts\nexport const pi = true;",
				default_max_file_size: 50,
				pattern_type: "include",
				pattern: "src/**/*.ts",
			} as T;
		}
		if (url.includes("api.github.com")) {
			return {
				full_name: "mario/pi",
				html_url: "https://github.com/mario/pi",
				stargazers_count: 42,
				forks_count: 3,
				open_issues_count: 2,
				default_branch: "main",
				owner: { login: "mario" },
				license: { spdx_id: "MIT" },
			} as T;
		}
		if (url.includes("registry.npmjs.org/pi-scraper/2.0.0")) {
			return {
				name: "pi-scraper",
				version: "2.0.0",
				description: "scrape",
				license: "MIT",
			} as T;
		}
		if (url.includes("registry.npmjs.org")) {
			expect(url).toBe("https://registry.npmjs.org/pi-scraper/latest");
			return {
				name: "pi-scraper",
				version: "1.2.3",
				description: "scrape",
				license: "MIT",
			} as T;
		}
		if (url.includes("pypi.org")) {
			return {
				info: {
					name: "requests",
					version: "2.0.0",
					summary: "HTTP",
					project_urls: { Source: "https://example.com" },
				},
			} as T;
		}
		if (url.includes("crates.io")) {
			return {
				crate: {
					id: "serde",
					name: "serde",
					description: "Serialize",
					max_version: "1.0.0",
					downloads: 100,
					license: "MIT OR Apache-2.0",
				},
			} as T;
		}
		if (url.includes("hub.docker.com")) {
			return {
				namespace: "library",
				name: "redis",
				repository_type: "image",
				description: "Redis",
				star_count: 9,
				pull_count: 1000,
				is_private: false,
			} as T;
		}
		if (url.includes("/api/models/")) {
			return {
				modelId: "org/model",
				author: "org",
				pipeline_tag: "text-generation",
				tags: ["safetensors"],
				downloads: 11,
				likes: 5,
			} as T;
		}
		if (url.includes("/api/datasets/")) {
			return {
				id: "org/dataset",
				author: "org",
				tags: ["text"],
				downloads: 12,
				likes: 6,
			} as T;
		}
		if (url.includes("hacker-news")) {
			return {
				id: 123,
				type: "story",
				title: "HN",
				url: "https://example.com",
				score: 10,
			} as T;
		}
		throw new Error(`Unexpected URL: ${url}`);
	},
	fetchText: async (url: string) => {
		if (url.endsWith("/src/api.ts")) {
			return `/** Fetch metrics.\n * @param {string} project - Project slug.\n */\nexport function fetchMetrics(project: string) { return project.length; }`;
		}
		if (url.includes("deepwiki.com")) {
			return `
				<div>Loading...<span>Index your code with Devin</span></div>
				<div>DeepWiki<span>mario/pi</span><button>Edit Wiki</button></div>
				<div>Last indexed: <!-- -->25 March 2026<!-- --> (<a href="https://github.com/mario/pi/commit/3cb2c4">3cb2c4</a>)</div>
				<nav>
					<a href="/mario/pi">Overview</a>
					<a href="/mario/pi/repository-structure">Repository Structure</a>
					<span>Packages</span><span>Feature Flags</span><span>Build System</span>
					<a href="/mario/pi/glossary">Glossary</a>
				</nav>
				<div>Menu<span>Overview</span></div>
				<section><h2>Relevant source files</h2><a>README.md</a><span>package.json</span></section>
				<footer>Footer links</footer>`;
		}
		if (!url.includes("export.arxiv.org")) throw new Error(`Unexpected text URL: ${url}`);
		return `<?xml version="1.0"?><feed><entry><id>http://arxiv.org/abs/2401.12345v1</id><title>Test Paper</title><summary>A useful paper.</summary><published>2024-01-01T00:00:00Z</published><updated>2024-01-02T00:00:00Z</updated><author><name>Ada Lovelace</name></author><category term="cs.CL"/><link title="pdf" href="http://arxiv.org/pdf/2401.12345v1"/></entry></feed>`;
	},
};

describe("vertical extractor registry", () => {
	it("lists capability declarations for deterministic extractors", () => {
		const names = listExtractorCapabilities().map((capability) => capability.name);
		expect(names).toEqual(
			expect.arrayContaining([
				"github_repo",
				"github_issue",
				"github_pr",
				"github_release",
				"gitingest",
				"npm",
				"pypi",
				"crates_io",
				"docker_hub",
				"huggingface_model",
				"huggingface_dataset",
				"hackernews",
				"reddit",
				"arxiv",
				"deepwiki",
				"docsite",
				"docstrings",
				"ossinsight_collections",
				"ossinsight_collection_ranking",
				"ossinsight_trending_repos",
				"ossinsight_repo_analytics",
				"youtube",
			]),
		);
		expect(listExtractorCapabilities()[0]).toMatchObject({
			requiresBrowser: false,
			requiresLLM: false,
			requiresCloud: false,
		});
		expect(
			listExtractorCapabilities().find((capability) => capability.name === "huggingface_model")
				?.urlPatterns,
		).toContain("https://huggingface.co/:model");
		expect(
			listExtractorCapabilities().find((capability) => capability.name === "huggingface_dataset")
				?.urlPatterns,
		).toContain("https://huggingface.co/datasets/:dataset");
	});

	it("runs named API-oriented extractors", async () => {
		const github = await runVerticalExtractor("github_repo", "https://github.com/mario/pi", {
			context,
		});
		expect(github.data).toMatchObject({
			fullName: "mario/pi",
			stars: 42,
			license: "MIT",
		});

		const npm = await runVerticalExtractor("npm", "https://www.npmjs.com/package/pi-scraper", {
			context,
		});
		expect(npm.data).toMatchObject({
			name: "pi-scraper",
			latestVersion: "1.2.3",
		});

		const npmVersion = await runVerticalExtractor(
			"npm",
			"https://www.npmjs.com/package/pi-scraper/v/2.0.0",
			{ context },
		);
		expect(npmVersion.data).toMatchObject({
			name: "pi-scraper",
			version: "2.0.0",
			requestedVersion: "2.0.0",
		});
		expect((npmVersion.data as Record<string, unknown> | undefined)?.latestVersion).toBeUndefined();

		const npmxPackage = await runVerticalExtractor("npm", "https://npmx.dev/package/pi-scraper", {
			context,
		});
		expect(npmxPackage.data).toMatchObject({
			name: "pi-scraper",
			latestVersion: "1.2.3",
		});

		const deepwiki = await runVerticalExtractor("deepwiki", "https://deepwiki.com/mario/pi", {
			context,
		});
		expect(deepwiki.data).toMatchObject({
			owner: "mario",
			repo: "pi",
			githubUrl: "https://github.com/mario/pi",
			lastIndexed: "25 March 2026",
			commit: "3cb2c4",
			activeSection: "Overview",
		});
		expect((deepwiki.data as Record<string, unknown> | undefined)?.sections).toEqual([
			"Overview",
			"Repository Structure",
			"Packages",
			"Feature Flags",
			"Build System",
		]);
		expect((deepwiki.data as Record<string, unknown> | undefined)?.sourceFiles).toEqual([
			"README.md",
			"package.json",
		]);
		await expect(
			runVerticalExtractor("deepwiki", "https://deepwiki.com/mario/pi/overview", { context }),
		).resolves.toMatchObject({ data: { owner: "mario", repo: "pi" } });
	});

	it("runs added GitHub issue, PR, and release extractors", async () => {
		await expect(
			runVerticalExtractor("github_issue", "https://github.com/mario/pi/issues/7", { context }),
		).resolves.toMatchObject({
			data: { number: 7, title: "Bug", labels: ["bug"] },
		});
		await expect(
			runVerticalExtractor("github_pr", "https://github.com/mario/pi/pull/8", {
				context,
			}),
		).resolves.toMatchObject({
			data: { number: 8, title: "Patch", changedFiles: 2 },
		});
		await expect(
			runVerticalExtractor("github_release", "https://github.com/mario/pi/releases/tag/v1.0.0", {
				context,
			}),
		).resolves.toMatchObject({ data: { tag: "v1.0.0", name: "One" } });
	});

	it("runs added registry and catalog extractors", async () => {
		await expect(
			runVerticalExtractor(
				"gitingest",
				"https://gitingest.com/mario/pi?max_file_size=50&pattern_type=include&pattern=src%2F**%2F*.ts",
				{ context },
			),
		).resolves.toMatchObject({
			data: {
				owner: "mario",
				repo: "pi",
				digestUrl: "https://example.com/mario-pi.txt",
				patternType: "include",
			},
		});
		await expect(
			runVerticalExtractor("crates_io", "https://crates.io/crates/serde", {
				context,
			}),
		).resolves.toMatchObject({
			data: { name: "serde", latestVersion: "1.0.0" },
		});
		await expect(
			runVerticalExtractor("docker_hub", "https://hub.docker.com/_/redis", {
				context,
			}),
		).resolves.toMatchObject({
			data: { namespace: "library", name: "redis", pulls: 1000 },
		});
		await expect(
			runVerticalExtractor("huggingface_model", "https://huggingface.co/org/model", { context }),
		).resolves.toMatchObject({
			data: { id: "org/model", pipelineTag: "text-generation" },
		});
		await expect(
			runVerticalExtractor("huggingface_model", "https://huggingface.co/legacy-model", {
				context,
			}),
		).resolves.toMatchObject({ data: { pipelineTag: "text-generation" } });
		await expect(
			runVerticalExtractor("huggingface_dataset", "https://huggingface.co/datasets/org/dataset", {
				context,
			}),
		).resolves.toMatchObject({ data: { id: "org/dataset", downloads: 12 } });
		await expect(
			runVerticalExtractor(
				"huggingface_dataset",
				"https://huggingface.co/datasets/legacy-dataset",
				{
					context,
				},
			),
		).resolves.toMatchObject({ data: { downloads: 12 } });
	});

	it("runs the arXiv feed extractor", async () => {
		await expect(
			runVerticalExtractor("arxiv", "https://arxiv.org/abs/2401.12345", {
				context,
			}),
		).resolves.toMatchObject({
			data: {
				id: "2401.12345v1",
				title: "Test Paper",
				authors: ["Ada Lovelace"],
				categories: ["cs.CL"],
			},
		});
	});

	it("extracts raw source docstrings through a deterministic vertical", async () => {
		const result = await runVerticalExtractor("docstrings", "https://example.com/src/api.ts", {
			context,
		});

		expect(result.error).toBeUndefined();
		expect(result.data).toMatchObject({
			file: "/src/api.ts",
			exports: [{ name: "fetchMetrics", kind: "function" }],
		});
	});

	it("returns structured unsupported and provider errors", async () => {
		await expect(
			runVerticalExtractor("missing", "https://example.com", { context }),
		).resolves.toMatchObject({ error: { code: "EXTRACTOR_NOT_FOUND" } });
		await expect(
			runVerticalExtractor("github_repo", "https://github.com/mario/pi/issues/7", { context }),
		).resolves.toMatchObject({ error: { code: "URL_NOT_SUPPORTED" } });
		await expect(
			runVerticalExtractor("github_repo", "https://example.com", { context }),
		).resolves.toMatchObject({ error: { code: "URL_NOT_SUPPORTED" } });
		await expect(
			runVerticalExtractor("crates_io", "https://crates.io/crates/fail", {
				context: {
					fetchJson: async () => {
						throw new Error("provider down");
					},
				},
			}),
		).resolves.toMatchObject({
			error: { code: "EXTRACTION_FAILED", message: "provider down" },
		});
	});
});
